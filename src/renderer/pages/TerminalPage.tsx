import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buttonStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'

let terminalPageCache: {
  tabs: TerminalTabState[]
  activeTabId: string
  experimentalEnabled: boolean
  sessionStateBySessionId: Record<string, 'running' | 'idle'>
} | null = null

export function TerminalPage({
  commandName,
  commands,
  onBack,
  onActionError
}: {
  commandName: string
  commands: Array<{ name: string }>
  onBack: () => void
  onActionError: (message: string) => void
}) {
  const actionErrorRef = useRef(onActionError)
  const experimentalEnabledRef = useRef(false)
  const insightTimerRef = useRef<number | null>(null)
  const initialTerminalRef = useRef<ReturnType<typeof resolveInitialTerminalState> | null>(null)
  if (initialTerminalRef.current === null) {
    initialTerminalRef.current = resolveInitialTerminalState(commandName)
  }
  const [tabs, setTabs] = useState<TerminalTabState[]>(() => initialTerminalRef.current!.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTerminalRef.current!.activeTabId)
  const [experimentalEnabled, setExperimentalEnabled] = useState(() => initialTerminalRef.current!.experimentalEnabled)
  const [observerPreview, setObserverPreview] = useState('')
  const [insight, setInsight] = useState('尚未生成洞察。')
  const [insightError, setInsightError] = useState('')
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightUpdatedAt, setInsightUpdatedAt] = useState<number | null>(null)
  const [sessionStateBySessionId, setSessionStateBySessionId] = useState<Record<string, 'running' | 'idle'>>(
    () => initialTerminalRef.current!.sessionStateBySessionId
  )
  const [isLightTheme, setIsLightTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.dataset.theme === 'light'
  })

  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  )
  const activePane = useMemo(
    () => activeTab?.panes.find((item) => item.id === activeTab.activePaneId) || activeTab?.panes[0] || null,
    [activeTab]
  )
  const activeCommand = activePane?.commandName || ''

  useEffect(() => {
    if (tabs.length === 0) {
      const first = createTab('会话 1', commandName || '')
      setTabs([first])
      setActiveTabId(first.id)
      return
    }
    if (!tabs.some((item) => item.id === activeTabId)) {
      setActiveTabId(tabs[0].id)
    }
  }, [tabs, activeTabId, commandName])

  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    experimentalEnabledRef.current = experimentalEnabled
  }, [experimentalEnabled])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = () => setIsLightTheme(root.dataset.theme === 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!commandName || !activeTab) return
    const currentPane = activeTab.panes.find((pane) => pane.id === activeTab.activePaneId)
    if (!currentPane) return
    if (currentPane.commandName === commandName) return

    // 外部命令切换时必须切新会话，避免复用旧 sessionId 导致串台。
    if (currentPane.commandName && currentPane.sessionId) {
      void window.api.terminalStop(currentPane.commandName, { sessionId: currentPane.sessionId })
    }
    const nextSessionId = tabsafeId('session')
    setSessionStateBySessionId((prev) => {
      const next = { ...prev }
      if (currentPane.sessionId) delete next[currentPane.sessionId]
      return next
    })
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab
        const nextPanes = tab.panes.map((pane) =>
          pane.id === tab.activePaneId ? { ...pane, commandName, sessionId: nextSessionId } : pane
        )
        return { ...tab, panes: nextPanes }
      })
    )
  }, [commandName, activeTab])

  useEffect(() => {
    terminalPageCache = {
      tabs,
      activeTabId,
      experimentalEnabled,
      sessionStateBySessionId
    }
  }, [tabs, activeTabId, experimentalEnabled, sessionStateBySessionId])

  async function refreshInsight(reason: 'observer' | 'manual'): Promise<void> {
    if (!activeCommand) return
    setInsightLoading(true)
    setInsightError('')
    try {
      const { text } = await window.api.terminalGetBuffer(activeCommand, { sessionId: activePane?.sessionId })
      const lines = sanitizeTerminalLines(text).slice(-120)
      if (lines.length === 0) {
        setInsight('当前会话暂无可分析输出。')
        setInsightUpdatedAt(Date.now())
        return
      }
      const result = await window.api.queryAiChat({
        requestId: `terminal-insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input:
          reason === 'manual'
            ? '请基于以下终端输出给出最多3条洞察（异常、风险、建议动作），优先关注错误与性能风险。'
            : '请基于最新终端输出增量给出最多3条洞察（异常、风险、建议动作），用简洁中文。'
        ,
        history: [],
        selectedCommand: activeCommand,
        sessionLogs: lines,
        queryOutputLines: []
      })
      setInsight(result.answer.trim() || '未提取到有效洞察。')
      setInsightUpdatedAt(Date.now())
    } catch {
      const fallback = buildFallbackInsight(observerPreview)
      setInsight(fallback)
      setInsightError('AI 洞察暂时不可用，已使用规则回退结果。')
      setInsightUpdatedAt(Date.now())
    } finally {
      setInsightLoading(false)
    }
  }

  useEffect(() => {
    setObserverPreview('')
    setInsight('尚未生成洞察。')
    setInsightError('')
    setInsightUpdatedAt(null)
  }, [activeCommand, activePane?.id])

  function createNewTab() {
    const next = createTab(`会话 ${tabs.length + 1}`, activeCommand || commandName || commands[0]?.name || '')
    setTabs((prev) => [...prev, next])
    setActiveTabId(next.id)
  }

  function stopPaneSessions(panes: TerminalPaneState[]) {
    for (const pane of panes) {
      if (!pane.commandName || !pane.sessionId) continue
      void window.api.terminalStop(pane.commandName, { sessionId: pane.sessionId })
    }
  }

  function closeTab(tabId: string) {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const idx = prev.findIndex((item) => item.id === tabId)
      if (idx < 0) return prev
      const tab = prev[idx]
      stopPaneSessions(tab.panes)
      const next = prev.filter((item) => item.id !== tabId)
      if (activeTabId === tabId) {
        const fallback = next[Math.max(0, idx - 1)]
        if (fallback) setActiveTabId(fallback.id)
      }
      return next
    })
  }

  function updateActiveTab(updater: (tab: TerminalTabState) => TerminalTabState) {
    if (!activeTab) return
    setTabs((prev) => prev.map((item) => (item.id === activeTab.id ? updater(item) : item)))
  }

  function applyLayout(layout: TerminalLayout) {
    updateActiveTab((tab) => {
      const paneCount = layout === 'single' ? 1 : layout === 'horizontal-2' || layout === 'vertical-2' ? 2 : 4
      const nextPanes = ensurePaneCount(tab.panes, paneCount, commandName || commands[0]?.name || '')
      if (nextPanes.length < tab.panes.length) {
        stopPaneSessions(tab.panes.slice(nextPanes.length))
      }
      const nextActive = nextPanes.some((pane) => pane.id === tab.activePaneId) ? tab.activePaneId : nextPanes[0]?.id || ''
      const fullscreenPaneId = tab.fullscreenPaneId && nextPanes.some((pane) => pane.id === tab.fullscreenPaneId) ? tab.fullscreenPaneId : undefined
      return { ...tab, layout, panes: nextPanes, activePaneId: nextActive, fullscreenPaneId }
    })
  }

  function removePane(paneId: string) {
    updateActiveTab((tab) => {
      if (tab.panes.length <= 1) return tab
      const target = tab.panes.find((pane) => pane.id === paneId)
      if (!target) return tab
      stopPaneSessions([target])
      const nextPanes = tab.panes.filter((pane) => pane.id !== paneId)
      const nextActive = tab.activePaneId === paneId ? nextPanes[0]?.id || '' : tab.activePaneId
      const fullscreenPaneId = tab.fullscreenPaneId === paneId ? undefined : tab.fullscreenPaneId
      return { ...tab, panes: nextPanes, activePaneId: nextActive, fullscreenPaneId }
    })
  }

  function togglePaneFullscreen(paneId: string) {
    updateActiveTab((tab) => ({
      ...tab,
      fullscreenPaneId: tab.fullscreenPaneId === paneId ? undefined : paneId,
      activePaneId: paneId
    }))
  }

  const visiblePanes = useMemo(() => {
    if (!activeTab) return []
    if (!activeTab.fullscreenPaneId) return activeTab.panes
    const fullscreenPane = activeTab.panes.find((pane) => pane.id === activeTab.fullscreenPaneId)
    return fullscreenPane ? [fullscreenPane] : activeTab.panes
  }, [activeTab])

  const gridTemplate = useMemo(() => {
    if (!activeTab) return { columns: '1fr', rows: '1fr' }
    if (activeTab.fullscreenPaneId) return { columns: '1fr', rows: '1fr' }
    // minmax 保证从全屏还原后行高一致，避免仅一侧被内容撑高导致左右/上下不对齐
    if (activeTab.layout === 'horizontal-2') return { columns: 'repeat(2, minmax(0, 1fr))', rows: 'minmax(0, 1fr)' }
    if (activeTab.layout === 'vertical-2') return { columns: '1fr', rows: 'repeat(2, minmax(0, 1fr))' }
    if (activeTab.layout === 'grid-4') return { columns: 'repeat(2, minmax(0, 1fr))', rows: 'repeat(2, minmax(0, 1fr))' }
    return { columns: '1fr', rows: 'minmax(0, 1fr)' }
  }, [activeTab])

  const shellPanelBaseStyle = useMemo(
    () =>
      ({
        background: isLightTheme ? '#0f131b' : '#000000',
        border: isLightTheme
          ? '1px solid color-mix(in srgb, #334155 62%, #0f131b)'
          : '1px solid color-mix(in srgb, var(--border-default) 78%, #000000)',
        boxShadow: isLightTheme
          ? 'inset 0 0 0 1px color-mix(in srgb, #64748b 28%, transparent)'
          : 'inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 35%, transparent)'
      }) as const,
    [isLightTheme]
  )

  const shellTextColor = isLightTheme ? '#f8fafc' : 'color-mix(in srgb, var(--text) 28%, #f3f4f6)'
  const shellMutedColor = isLightTheme ? '#cbd5e1' : 'color-mix(in srgb, var(--muted) 45%, #cbd5e1)'

  const shellControlStyle = useMemo(
    () =>
      ({
        borderRadius: 'var(--radius-sm)',
        border: isLightTheme
          ? '1px solid color-mix(in srgb, #64748b 65%, #1e293b)'
          : '1px solid color-mix(in srgb, var(--border-default) 82%, #000000)',
        background: isLightTheme
          ? 'color-mix(in srgb, #1e293b 72%, #0f131b)'
          : 'color-mix(in srgb, #0a0a0a 88%, var(--panel-soft))',
        color: shellTextColor,
        padding: '4px 8px',
        fontSize: 12
      }) as const,
    [isLightTheme, shellTextColor]
  )

  const shellMetaTextStyle = { color: shellMutedColor } as const
  const pageMetaTextStyle = { color: isLightTheme ? 'var(--muted)' : shellMutedColor } as const

  return (
    <div
      data-testid="terminal-page"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Panel
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <button
                data-testid="terminal-back-icon"
                onClick={onBack}
                title="返回上一级"
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 14,
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--panel-soft)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1
                }}
              >
                ←
              </button>
              <div style={{ fontWeight: 700, fontSize: 14 }}>命令交互窗口 · {activeCommand || '未选择命令'}</div>
            </div>
            <div style={{ fontSize: 12, ...pageMetaTextStyle }}>
              状态：{activeCommand ? (activePane?.sessionId && sessionStateBySessionId[activePane.sessionId] === 'running' ? '正在连接' : '已结束') : '未选择'}（支持交互式命令，如
              tail -f）
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button style={buttonStyle(activeTab?.layout === 'single' ? 'primary' : 'muted')} onClick={() => applyLayout('single')}>
              单窗口
            </button>
            <button style={buttonStyle(activeTab?.layout === 'horizontal-2' ? 'primary' : 'muted')} onClick={() => applyLayout('horizontal-2')}>
              左右双栏
            </button>
            <button style={buttonStyle(activeTab?.layout === 'vertical-2' ? 'primary' : 'muted')} onClick={() => applyLayout('vertical-2')}>
              上下双行
            </button>
            <button style={buttonStyle(activeTab?.layout === 'grid-4' ? 'primary' : 'muted')} onClick={() => applyLayout('grid-4')}>
              四宫格
            </button>
            <button
              style={buttonStyle(experimentalEnabled ? 'primary' : 'muted')}
              onClick={() => {
                setExperimentalEnabled((prev) => !prev)
              }}
            >
              {experimentalEnabled ? '关闭 AI 洞察（实验）' : 'AI 洞察（实验）'}
            </button>
            <button
              data-testid="terminal-stop-session"
              style={buttonStyle('warn')}
              onClick={async () => {
                if (!activeCommand || !activePane?.sessionId) return
                try {
                  await window.api.terminalStop(activeCommand, { sessionId: activePane.sessionId })
                  setSessionStateBySessionId((prev) => ({ ...prev, [activePane.sessionId]: 'idle' }))
                } catch (error) {
                  onActionError(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              终止会话
            </button>
            <button style={buttonStyle('muted')} onClick={onBack}>
              回到首页
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, overflowX: 'auto', flexShrink: 0 }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  borderRadius: 'var(--radius-pill)',
                  border: isActive
                    ? `1px solid ${isLightTheme ? 'color-mix(in srgb, var(--accent) 48%, var(--border-default))' : 'color-mix(in srgb, var(--accent) 70%, #94a3b8)'}`
                    : `1px solid ${isLightTheme ? 'var(--border-default)' : 'color-mix(in srgb, var(--border-default) 72%, #0a0a0a)'}`,
                  background: isActive
                    ? `color-mix(in srgb, var(--accent-soft) ${isLightTheme ? '72%' : '65%'}, ${isLightTheme ? 'var(--panel)' : '#0a0a0a'})`
                    : `color-mix(in srgb, var(--panel-soft) ${isLightTheme ? '100%' : '20%'}, ${isLightTheme ? 'var(--panel)' : '#0a0a0a'})`,
                  padding: '4px 8px'
                }}
              >
                <button
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: isActive ? (isLightTheme ? 'var(--text)' : shellTextColor) : isLightTheme ? 'var(--text-dim)' : shellMutedColor,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.title}
                </button>
                {tabs.length > 1 ? (
                  <button
                    title="关闭标签"
                    onClick={() => closeTab(tab.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: isLightTheme ? 'var(--text-dim)' : shellMutedColor,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
          <button style={buttonStyle('muted')} onClick={createNewTab}>
            + 新建 Tab
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: experimentalEnabled ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 10,
            flex: 1,
            minHeight: 0,
            alignItems: 'stretch'
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate.columns,
              gridTemplateRows: gridTemplate.rows,
              gap: 10,
              alignItems: 'stretch',
              minHeight: 0,
              height: '100%'
            }}
          >
            {visiblePanes.map((pane) => {
              const isPaneActive = pane.id === activeTab?.activePaneId
              const isPaneFullscreen = activeTab?.fullscreenPaneId === pane.id
              return (
                <div
                  key={pane.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    height: '100%',
                    alignSelf: 'stretch'
                  }}
                  onClick={() => {
                    updateActiveTab((tab) => ({ ...tab, activePaneId: pane.id }))
                  }}
                >
                  <Panel
                    soft
                    style={{
                      ...shellPanelBaseStyle,
                      padding: 8,
                      borderRadius: 'var(--radius-lg)',
                      border: isPaneActive ? '1px solid var(--accent)' : shellPanelBaseStyle.border,
                      minHeight: 0,
                      flex: 1,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                        padding: 6,
                        borderRadius: 'var(--radius-sm)',
                        background: isLightTheme
                          ? 'color-mix(in srgb, #1e293b 70%, #0f131b)'
                          : 'color-mix(in srgb, #0a0a0a 82%, var(--panel-soft))',
                        border: isLightTheme
                          ? '1px solid color-mix(in srgb, #64748b 60%, #1e293b)'
                          : '1px solid color-mix(in srgb, var(--border-subtle) 45%, #0a0a0a)'
                      }}
                    >
                      <span style={{ fontSize: 12, color: shellTextColor }}>Pane</span>
                      <span
                        title="当前命令由命令列表选定，此处不可切换"
                        style={{
                          ...shellControlStyle,
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 28,
                          cursor: 'default',
                          userSelect: 'text',
                          flexShrink: 0,
                          maxWidth: 'min(420px, 100%)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {pane.commandName || '未绑定命令'}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, ...shellMetaTextStyle }}>
                        {pane.commandName
                          ? sessionStateBySessionId[pane.sessionId] === 'running'
                            ? '运行中'
                            : '空闲'
                          : '未绑定'}
                      </span>
                      <button
                        style={{ ...buttonStyle('muted'), ...shellControlStyle, padding: '6px 10px' }}
                        onClick={(event) => {
                          event.stopPropagation()
                          togglePaneFullscreen(pane.id)
                        }}
                      >
                        {isPaneFullscreen ? '还原' : '全屏'}
                      </button>
                      <button
                        style={{
                          ...buttonStyle('warn'),
                          ...shellControlStyle,
                          border: '1px solid color-mix(in srgb, var(--warn) 52%, #222222)',
                          color: 'var(--warn)',
                          background: 'color-mix(in srgb, var(--warn) 14%, #0a0a0a)',
                          padding: '6px 10px'
                        }}
                        disabled={(activeTab?.panes.length || 0) <= 1}
                        onClick={(event) => {
                          event.stopPropagation()
                          removePane(pane.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                    <TerminalPane
                      paneId={pane.id}
                      commandName={pane.commandName}
                      sessionId={pane.sessionId}
                      onActionError={(message) => actionErrorRef.current(message)}
                      onObserver={(payload) => {
                        if (!isPaneActive) return
                        setObserverPreview(payload)
                        if (!experimentalEnabledRef.current) return
                        if (insightTimerRef.current) window.clearTimeout(insightTimerRef.current)
                        insightTimerRef.current = window.setTimeout(() => {
                          void refreshInsight('observer')
                        }, 1200)
                      }}
                      onStatus={(state) => {
                        if (!pane.sessionId) return
                        setSessionStateBySessionId((prev) => ({ ...prev, [pane.sessionId]: state }))
                      }}
                    />
                  </Panel>
                </div>
              )
            })}
          </div>
          {experimentalEnabled && (
            <Panel
              soft
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 0,
                height: '100%',
                overflow: 'hidden'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>AI 洞察（实验）</div>
                <button
                  style={buttonStyle('muted')}
                  disabled={insightLoading}
                  onClick={() => {
                    void refreshInsight('manual')
                  }}
                >
                  {insightLoading ? '分析中...' : '手动刷新'}
                </button>
              </div>
              <div style={{ fontSize: 12, ...shellMetaTextStyle, flexShrink: 0 }}>
                来源：terminal observer（节流）{insightUpdatedAt ? `· 更新于 ${new Date(insightUpdatedAt).toLocaleTimeString()}` : ''}
              </div>
              {insightError ? (
                <div style={{ fontSize: 12, color: 'var(--err)', flexShrink: 0 }}>{insightError}</div>
              ) : null}
              <Panel
                style={{
                  ...shellPanelBaseStyle,
                  padding: 10,
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5
                }}
              >
                {insight}
              </Panel>
              <div style={{ fontSize: 12, ...shellMetaTextStyle, flexShrink: 0 }}>最近增量片段</div>
              <Panel
                style={{
                  ...shellPanelBaseStyle,
                  padding: 10,
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                  lineHeight: 1.45
                }}
              >
                {observerPreview || '暂无增量数据'}
              </Panel>
            </Panel>
          )}
        </div>
      </Panel>
    </div>
  )
}

function TerminalPane({
  paneId,
  commandName,
  sessionId,
  onActionError,
  onObserver,
  onStatus
}: {
  paneId: string
  commandName: string
  sessionId: string
  onActionError: (message: string) => void
  onObserver: (chunk: string) => void
  onStatus: (state: 'running' | 'idle') => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const onActionErrorRef = useRef(onActionError)
  const onObserverRef = useRef(onObserver)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onActionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    onObserverRef.current = onObserver
  }, [onObserver])

  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      convertEol: false,
      scrollback: 8000
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(hostRef.current)
    fitAddon.fit()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    return () => {
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !fitAddonRef.current || !terminalRef.current || !commandName || !sessionId) return
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    const onResize = () => {
      fitAddon.fit()
      void window.api.terminalResize(commandName, terminal.cols, terminal.rows, { sessionId })
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(host)
    window.addEventListener('resize', onResize)

    const inputDisposable = terminal.onData((data) => {
      void window.api.terminalInput(commandName, data, { sessionId })
    })
    const offData = window.api.onTerminalData((payload) => {
      if (payload.sessionId !== sessionId) return
      if (payload.commandName !== commandName) return
      terminal.write(payload.data)
    })
    const offObserver = window.api.onTerminalObserver((payload) => {
      if (payload.sessionId !== sessionId) return
      if (payload.commandName !== commandName) return
      onObserverRef.current(payload.chunk)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.sessionId !== sessionId) return
      if (payload.commandName !== commandName) return
      onStatusRef.current(payload.state)
      if (payload.state === 'idle' && typeof payload.exitCode === 'number') {
        terminal.write(`\r\n\r\n[会话已结束，状态码 (Exit Code) ${payload.exitCode}]\r\n`)
      }
    })
    /** 首页「打开窗口」会占用无 sessionId 的默认槽；进入交互页再启 Pane 会形成双 PTY，仅终止 Pane 时列表仍显示运行中。 */
    let disposed = false
    const startSession = async () => {
      try {
        await window.api.terminalStop(commandName)
      } catch {
        /* 无默认槽时忽略 */
      }
      if (disposed) return
      try {
        const result = await window.api.terminalStart(commandName, { sessionId })
        if (disposed) return
        if (result.buffer) terminal.write(result.buffer)
        onStatusRef.current(result.state || 'running')
        if ((result.state || 'running') === 'running') {
          void window.api.terminalResize(commandName, terminal.cols, terminal.rows, { sessionId })
        }
      } catch (error) {
        if (!disposed) {
          onActionErrorRef.current(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void startSession()

    return () => {
      disposed = true
      inputDisposable.dispose()
      offData?.()
      offObserver?.()
      offStatus?.()
      resizeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      terminal.reset()
    }
  }, [commandName, paneId, sessionId])

  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {commandName ? (
        <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--muted)',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)'
          }}
        >
          请选择命令后开始会话
        </div>
      )}
    </div>
  )
}

type TerminalLayout = 'single' | 'horizontal-2' | 'vertical-2' | 'grid-4'

interface TerminalPaneState {
  id: string
  commandName: string
  sessionId: string
}

interface TerminalTabState {
  id: string
  title: string
  layout: TerminalLayout
  panes: TerminalPaneState[]
  activePaneId: string
  fullscreenPaneId?: string
}

function createTab(title: string, initialCommand: string): TerminalTabState {
  const firstPane = { id: tabsafeId('pane'), commandName: initialCommand, sessionId: tabsafeId('session') }
  return {
    id: tabsafeId('tab'),
    title,
    layout: 'single',
    panes: [firstPane],
    activePaneId: firstPane.id
  }
}

/** 恢复缓存前校验当前入口命令与活动 Pane 一致，避免二次进入时沿用旧命令导致串台。 */
function resolveInitialTerminalState(incomingCommand: string): {
  tabs: TerminalTabState[]
  activeTabId: string
  experimentalEnabled: boolean
  sessionStateBySessionId: Record<string, 'running' | 'idle'>
} {
  const cache = terminalPageCache
  if (cache?.tabs?.length) {
    const tab = cache.tabs.find((t) => t.id === cache.activeTabId) || cache.tabs[0]
    const pane = tab?.panes.find((p) => p.id === tab.activePaneId) || tab?.panes[0]
    if (pane && (!incomingCommand || pane.commandName === incomingCommand)) {
      return {
        tabs: cache.tabs,
        activeTabId: cache.activeTabId,
        experimentalEnabled: cache.experimentalEnabled,
        sessionStateBySessionId: { ...cache.sessionStateBySessionId }
      }
    }
  }
  const first = createTab('会话 1', incomingCommand || '')
  return {
    tabs: [first],
    activeTabId: first.id,
    experimentalEnabled: cache?.experimentalEnabled || false,
    sessionStateBySessionId: {}
  }
}

function ensurePaneCount(panes: TerminalPaneState[], count: number, fallbackCommand: string): TerminalPaneState[] {
  if (panes.length === count) return panes
  if (panes.length > count) return panes.slice(0, count)
  const next = [...panes]
  while (next.length < count) {
    next.push({ id: tabsafeId('pane'), commandName: fallbackCommand, sessionId: tabsafeId('session') })
  }
  return next
}

function tabsafeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeTerminalLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r/g, '')
        .trimEnd()
    )
    .filter((line) => line.length > 0)
}

function buildFallbackInsight(chunk: string): string {
  const normalized = sanitizeTerminalLines(chunk).slice(-40).join('\n').toLowerCase()
  const findings: string[] = []
  if (/error|exception|fatal|failed/.test(normalized)) {
    findings.push('检测到错误关键词（error/exception/fatal），建议优先检查最近报错栈。')
  }
  if (/timeout|timed out|connection reset|broken pipe/.test(normalized)) {
    findings.push('检测到连接或超时迹象，建议检查网络连通性与下游服务状态。')
  }
  if (/oom|out of memory|killed process/.test(normalized)) {
    findings.push('检测到潜在内存压力，建议核对内存占用与进程限额。')
  }
  if (findings.length === 0) {
    findings.push('未命中高风险关键词，建议继续观察并手动刷新获取更完整洞察。')
  }
  return findings.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join('\n')
}
