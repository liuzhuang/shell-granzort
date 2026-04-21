import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CommandConfig, QueryAiHistoryItem } from '../../shared/types'
import { buttonStyle, inputStyle } from '../lib/uiStyles'

type TimelineEntry = { key: string; at: number; role: 'user' | 'assistant'; content: string }

const SPLIT_RATIO_STORAGE_KEY = 'query.layout.splitRatio.v1'
const LAST_QUERY_COMMAND_KEY = 'query.lastSelectedCommand.v1'
const MIN_LEFT_RATIO = 0.45
const MAX_LEFT_RATIO = 0.75
const COMPACT_ENTER_WIDTH = 1160
const COMPACT_EXIT_WIDTH = 1220
const CONFIRM_EXECUTE_STORAGE_KEY = 'query.ai.confirmExecute.v1'
const SECTION_STYLE = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 14,
  background: 'var(--panel-soft)'
} as const

export function QueryPage(props: {
  queryInput: string
  commandInput: string
  setCommandInput: (text: string) => void
  chatHistory: Array<QueryAiHistoryItem & { at: number }>
  streamingText: string
  isStreaming: boolean
  commands: CommandConfig[]
  selectedCommand: string
  terminalBadgeState: 'running' | 'idle_with_cache' | 'idle_empty'
  setQueryInput: (text: string) => void
  clearChatHistory: () => void
  translate: () => Promise<void>
  selectCommand: (name: string) => void
  onActionError: (message: string) => void
  favoriteCommands: string[]
  fillCommandFromFavorite: (command: string) => void
  addFavoriteCommand: () => void
  removeFavoriteCommand: (command: string) => void
}) {
  const {
    queryInput,
    commandInput,
    setCommandInput,
    chatHistory,
    streamingText,
    isStreaming,
    commands,
    selectedCommand,
    terminalBadgeState,
    setQueryInput,
    clearChatHistory,
    translate,
    selectCommand,
    onActionError,
    favoriteCommands,
    fillCommandFromFavorite,
    addFavoriteCommand,
    removeFavoriteCommand
  } = props

  const [showFavoritesDialog, setShowFavoritesDialog] = useState(false)
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const [isCompactLayout, setIsCompactLayout] = useState<boolean>(() => {
    const width = getViewportWidth()
    return resolveCompactLayout(width, false)
  })
  const [autoFollowTimeline, setAutoFollowTimeline] = useState(true)
  const [leftRatio, setLeftRatio] = useState<number>(() => loadSplitRatio())
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const [showTerminalFullscreen, setShowTerminalFullscreen] = useState(false)
  const [terminalSessionState, setTerminalSessionState] = useState<'running' | 'idle'>('idle')
  const [pendingAiCommand, setPendingAiCommand] = useState('')
  const [confirmBeforeExecute, setConfirmBeforeExecute] = useState<boolean>(() => loadConfirmBeforeExecute())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const inlineHostRef = useRef<HTMLDivElement | null>(null)
  const terminalPanelRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)

  const liveAssistantText = isStreaming ? (streamingText.trim() || 'AI 正在分析中...') : ''
  const activeCommandText = (isStreaming ? streamingText : commandInput).trim()
  const filteredFavorites = useMemo(() => {
    const keyword = favoriteSearch.trim().toLowerCase()
    if (!keyword) return favoriteCommands
    return favoriteCommands.filter((item) => item.toLowerCase().includes(keyword))
  }, [favoriteCommands, favoriteSearch])
  const timelineEntries = useMemo<TimelineEntry[]>(
    () =>
      chatHistory.map((item, idx) => ({
        key: `chat-${idx}-${item.at}`,
        at: item.at,
        role: item.role,
        content: item.content
      })),
    [chatHistory]
  )

  useEffect(() => {
    const onResize = () => {
      const width = getViewportWidth()
      setIsCompactLayout((prev) => resolveCompactLayout(width, prev))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!selectedCommand) return
    try {
      window.localStorage.setItem(LAST_QUERY_COMMAND_KEY, selectedCommand)
    } catch {
      // ignore storage errors
    }
  }, [selectedCommand])

  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(leftRatio))
    } catch {
      // ignore storage errors
    }
  }, [leftRatio])

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIRM_EXECUTE_STORAGE_KEY, confirmBeforeExecute ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [confirmBeforeExecute])

  useEffect(() => {
    if (!isDraggingSplit) return
    const onMouseMove = (event: MouseEvent) => {
      if (!rootRef.current) return
      const rect = rootRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const raw = (event.clientX - rect.left) / rect.width
      const next = Math.min(MAX_LEFT_RATIO, Math.max(MIN_LEFT_RATIO, raw))
      setLeftRatio(next)
    }
    const stopDrag = () => setIsDraggingSplit(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopDrag)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopDrag)
    }
  }, [isDraggingSplit])

  useEffect(() => {
    if (!autoFollowTimeline) return
    const el = timelineRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [timelineEntries, liveAssistantText, autoFollowTimeline])

  useTerminalSession({
    hostRef: inlineHostRef,
    commandName: selectedCommand,
    enabled: true,
    onStatusChange: setTerminalSessionState,
    onActionError
  })

  async function handleTranslate(): Promise<boolean> {
    if (!queryInput.trim() || isStreaming) return false
    try {
      await translate()
      return true
    } catch (error) {
      onActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async function handleRunDraftCommand(commandOverride?: string): Promise<void> {
    const commandToRun = (commandOverride ?? activeCommandText).trim()
    if (!selectedCommand) {
      onActionError('请先选择会话命令。')
      return
    }
    if (!commandToRun) {
      onActionError('请先生成或填写待执行命令。')
      return
    }
    try {
      await window.api.terminalStart(selectedCommand)
      await window.api.terminalInput(selectedCommand, `${commandToRun}\n`)
      setTerminalSessionState('running')
    } catch (error) {
      onActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleConfirmAiExecution(commandText: string): Promise<void> {
    const command = commandText.trim()
    if (!command) return
    setPendingAiCommand('')
    setCommandInput(command)
    await handleRunDraftCommand(command)
  }

  async function handleAiBubbleClick(commandText: string): Promise<void> {
    const command = commandText.trim()
    if (!command) return
    if (confirmBeforeExecute) {
      setPendingAiCommand((prev) => (prev === command ? '' : command))
      return
    }
    await handleConfirmAiExecution(command)
  }

  function toggleTerminalFullscreen(): void {
    setShowTerminalFullscreen((prev) => !prev)
  }

  return (
    <div
      ref={rootRef}
      data-testid="log-analysis-page"
      style={{
        flex: 1,
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: isCompactLayout ? '1fr' : `${leftRatio}fr 8px ${1 - leftRatio}fr`,
        gap: isCompactLayout ? 8 : 0,
        cursor: isDraggingSplit ? 'col-resize' : 'default',
        background: 'var(--panel)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 20,
        padding: 8,
        overflow: 'hidden'
      }}
    >
      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', paddingRight: isCompactLayout ? 0 : 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI 日志会话</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selectedCommand ? `当前目标：${selectedCommand}` : '请先选择会话命令'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={buttonStyle('muted')} onClick={() => setShowFavoritesDialog(true)}>查看收藏命令</button>
            <button data-testid="log-analysis-clear-chat" style={buttonStyle('muted')} onClick={clearChatHistory}>清空会话</button>
          </div>
        </div>

        <div
          ref={timelineRef}
          data-testid="log-analysis-chat-history"
          onScroll={(e) => {
            const el = e.currentTarget
            const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
            setAutoFollowTimeline(distance < 40)
          }}
          style={{ ...SECTION_STYLE, flex: 1, minHeight: 0, overflow: 'auto', marginTop: 6, display: 'grid', alignContent: 'start', gap: 6, padding: 18 }}
        >
          {timelineEntries.length === 0 && !liveAssistantText ? (
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>请输入问题，开始“生成命令 -&gt; 执行 -&gt; 继续追问”。</div>
          ) : null}
          {timelineEntries.map((entry) => (
            <div
              key={entry.key}
              style={{
                justifySelf: entry.role === 'user' ? 'end' : 'start',
                width: entry.role === 'user' ? 'fit-content' : 'auto',
                maxWidth: '92%',
                padding: '6px 8px',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: entry.role === 'user' ? 'rgba(74, 222, 128, 0.1)' : 'var(--panel)',
                cursor: entry.role === 'assistant' ? 'pointer' : 'default',
                textAlign: entry.role === 'user' ? 'right' : 'left'
              }}
              data-testid={entry.role === 'assistant' ? 'log-analysis-chat-bubble-ai' : 'log-analysis-chat-bubble-user'}
              onClick={() => {
                if (entry.role !== 'assistant') return
                void handleAiBubbleClick(entry.content)
              }}
            >
              <div style={{ marginBottom: 2, fontSize: 10, color: 'var(--muted)' }}>{entry.role === 'user' ? '我' : 'AI'}</div>
              {entry.content}
            </div>
          ))}
          {liveAssistantText ? (
            <div style={{ width: '92%', padding: '6px 8px', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--panel)' }}>
              <div style={{ marginBottom: 2, fontSize: 10, color: 'var(--muted)' }}>AI（生成中）</div>
              {liveAssistantText}
            </div>
          ) : null}
        </div>

        <div style={{ ...SECTION_STYLE, marginTop: 6, padding: 8 }}>
          <div style={{ position: 'relative' }}>
            <textarea
              data-testid="log-analysis-input"
              style={{
                ...inputStyle,
                marginTop: 0,
                minHeight: 108,
                resize: 'vertical',
                lineHeight: 1.45,
                background: 'var(--panel)',
                boxShadow:
                  'inset 0 0 0 1px var(--border-subtle), 0 2px 10px color-mix(in srgb, var(--border-subtle) 70%, transparent)',
                borderColor: 'var(--border-default)',
                paddingRight: 46,
                paddingBottom: 34
              }}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              placeholder="有问题，尽管问"
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
                  const native = e.nativeEvent as KeyboardEvent
                  const isImeComposing =
                    composingRef.current ||
                    native.isComposing ||
                    (native as unknown as { keyCode?: number }).keyCode === 229
                  if (isImeComposing) return
                  e.preventDefault()
                  const sent = await handleTranslate()
                  if (sent) setQueryInput('')
                }
              }}
            />
            <button
              type="button"
              aria-label="发送"
              data-testid="log-analysis-translate"
              onClick={handleTranslate}
              disabled={isStreaming || !queryInput.trim()}
              style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                width: 28,
                height: 28,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: isStreaming || !queryInput.trim() ? 'var(--panel-soft)' : 'var(--panel)',
                color: isStreaming || !queryInput.trim() ? 'var(--muted)' : 'var(--text)',
                cursor: isStreaming || !queryInput.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {isCompactLayout ? null : (
        <div role="separator" aria-orientation="vertical" onMouseDown={() => setIsDraggingSplit(true)} style={{ width: 8, cursor: 'col-resize', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
          <div style={{ width: 2, height: '42%', background: 'var(--border-subtle)' }} />
        </div>
      )}

      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', paddingLeft: isCompactLayout ? 0 : 6, gap: 6 }}>
        <div style={{ ...SECTION_STYLE, padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>命令草稿</div>
            <label
              data-testid="log-analysis-confirm-execute-toggle"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--muted)',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <input
                type="checkbox"
                checked={confirmBeforeExecute}
                onChange={(e) => {
                  const next = e.target.checked
                  setConfirmBeforeExecute(next)
                  if (!next) setPendingAiCommand('')
                }}
                style={{ accentColor: 'var(--accent)' }}
              />
              二次确认执行
            </label>
          </div>
          <select
            data-testid="log-analysis-command-select"
            value={selectedCommand}
            onChange={(e) => {
              const next = e.target.value
              selectCommand(next)
              try {
                window.localStorage.setItem(LAST_QUERY_COMMAND_KEY, next)
              } catch {
                // ignore storage errors
              }
            }}
            style={{ ...inputStyle, marginTop: 4 }}
          >
            <option value="">请选择命令</option>
            {commands.map((cmd) => (
              <option key={cmd.name} value={cmd.name}>{cmd.name}</option>
            ))}
          </select>
          <div style={{ position: 'relative', marginTop: 4 }}>
            <textarea
              data-testid="log-analysis-command-input"
              style={{ ...inputStyle, marginTop: 0, minHeight: 120, resize: 'vertical', fontFamily: 'var(--font-mono)', paddingRight: 78, paddingBottom: 34 }}
              value={isStreaming ? streamingText : commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="AI 生成后可在此微调再执行"
            />
            <button
              type="button"
              aria-label="执行命令"
              title="执行命令"
              data-testid="log-analysis-execute"
              onClick={() => void handleRunDraftCommand()}
              disabled={!selectedCommand || !activeCommandText}
              style={{
                position: 'absolute',
                right: 42,
                bottom: 8,
                width: 28,
                height: 28,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: !selectedCommand || !activeCommandText ? 'var(--panel-soft)' : 'var(--panel)',
                color: !selectedCommand || !activeCommandText ? 'var(--muted)' : 'var(--text)',
                cursor: !selectedCommand || !activeCommandText ? 'not-allowed' : 'pointer',
                fontSize: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ▶
            </button>
            <button
              type="button"
              aria-label="收藏当前命令"
              title="收藏当前命令"
              data-testid="log-analysis-favorite-add"
              onClick={addFavoriteCommand}
              disabled={!activeCommandText}
              style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: !activeCommandText ? 'var(--panel-soft)' : 'var(--panel)',
                color: !activeCommandText ? 'var(--muted)' : 'var(--text)',
                cursor: !activeCommandText ? 'not-allowed' : 'pointer',
                fontSize: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ★
            </button>
          </div>
        </div>

        {/* 外层 flex:1 在列布局里高度已确定；子级用 absolute 填满槽位，全屏改 fixed，无需占位 div，避免退出全屏时占位与面板同时变化导致闪动 */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div
            ref={terminalPanelRef}
            style={{
              ...SECTION_STYLE,
              ...(showTerminalFullscreen ? { background: 'var(--panel)' } : null),
              position: showTerminalFullscreen ? 'fixed' : 'absolute',
              ...(showTerminalFullscreen
                ? {
                    inset: '5vh 4vw',
                    zIndex: 90,
                    borderRadius: 20,
                    boxShadow: 'var(--shadow-hover)'
                  }
                : { top: 0, left: 0, right: 0, bottom: 0 }),
              minHeight: 220,
              overflow: 'hidden',
              padding: 8,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>执行终端（{terminalSessionState === 'running' ? '运行中' : '空闲'}）</div>
              <SessionBadge state={terminalBadgeState} />
            </div>
            <button
              type="button"
              aria-label="放大终端"
              title={showTerminalFullscreen ? '退出全屏' : '放大终端（可手动敲命令）'}
              style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 12 }}
              onClick={toggleTerminalFullscreen}
            >
              {showTerminalFullscreen ? '×' : '⛶'}
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--border-subtle)', borderRadius: 6, overflow: 'hidden', background: '#0d1117' }}>
            <div ref={inlineHostRef} style={{ height: '100%', width: '100%' }} />
          </div>
          </div>
        </div>
      </div>

      <div
        data-testid="log-analysis-fullscreen-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          zIndex: 80,
          opacity: showTerminalFullscreen ? 1 : 0,
          pointerEvents: showTerminalFullscreen ? 'auto' : 'none',
          transition: 'opacity 160ms ease',
          willChange: 'opacity'
        }}
        onClick={() => {
          if (!showTerminalFullscreen) return
          toggleTerminalFullscreen()
        }}
      />

      {showFavoritesDialog ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setShowFavoritesDialog(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 92vw)', maxHeight: '72vh', overflow: 'auto', background: 'var(--panel)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>我的收藏命令</div>
              <button data-testid="log-analysis-close-favorites-dialog" style={buttonStyle('muted')} onClick={() => setShowFavoritesDialog(false)}>关闭</button>
            </div>
            <input style={{ ...inputStyle, marginTop: 8 }} value={favoriteSearch} onChange={(e) => setFavoriteSearch(e.target.value)} placeholder="搜索收藏命令" />
            <div data-testid="log-analysis-favorites" style={{ marginTop: 8, display: 'grid', gap: 4 }}>
              {filteredFavorites.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>暂无匹配的收藏命令。</div>
              ) : (
                filteredFavorites.map((cmd, idx) => (
                  <div key={`${idx}-${cmd.slice(0, 40)}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <button
                      data-testid="log-analysis-favorite-row"
                      title={cmd}
                      style={{ ...buttonStyle('muted'), flex: 1, textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-all' }}
                      onClick={() => {
                        fillCommandFromFavorite(cmd)
                        setShowFavoritesDialog(false)
                      }}
                    >
                      {formatFavoritePreview(cmd)}
                    </button>
                    <button
                      data-testid={`log-analysis-favorite-remove-${idx}`}
                      title="取消收藏"
                      style={{ ...buttonStyle('warn'), flexShrink: 0, padding: '2px 6px', fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFavoriteCommand(cmd)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingAiCommand ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 95
          }}
          onClick={() => setPendingAiCommand('')}
          data-testid="log-analysis-ai-execute-dialog-mask"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="log-analysis-ai-execute-dialog"
            style={{
              width: 'min(620px, 90vw)',
              borderRadius: 14,
              border: '1px solid var(--border-subtle)',
              background: 'var(--panel)',
              boxShadow: 'var(--shadow-card)',
              padding: 12
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>确认执行 AI 命令</div>
            <div
              style={{
                maxHeight: 180,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--panel-soft)',
                padding: '8px 10px'
              }}
            >
              {pendingAiCommand}
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                data-testid="log-analysis-ai-cancel-execute"
                style={buttonStyle('muted')}
                onClick={() => setPendingAiCommand('')}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="log-analysis-ai-confirm-execute"
                style={buttonStyle('primary')}
                onClick={() => void handleConfirmAiExecution(pendingAiCommand)}
              >
                确定执行
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  )
}

function useTerminalSession(args: {
  hostRef: React.RefObject<HTMLDivElement | null>
  commandName: string
  enabled: boolean
  onStatusChange: (state: 'running' | 'idle') => void
  onActionError: (message: string) => void
}) {
  const { hostRef, commandName, enabled, onStatusChange, onActionError } = args
  const statusChangeRef = useRef(onStatusChange)
  const actionErrorRef = useRef(onActionError)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: -1, rows: -1 })
  const activeCommandRef = useRef('')
  const offDataRef = useRef<(() => void) | null>(null)
  const offStatusRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    const host = hostRef.current
    if (!enabled || !host) return
    if (terminalRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      convertEol: false,
      scrollback: 12000,
      theme: {
        background: '#0d1117',
        foreground: '#d3d7dc',
        cursor: '#7aa2f7'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const onResize = () => {
      const t = terminalRef.current
      const addon = fitAddonRef.current
      const activeCommand = activeCommandRef.current
      if (!t || !addon) return
      const dims = addon.proposeDimensions()
      if (!dims) return
      const nextCols = Math.max(20, Math.floor(dims.cols))
      const nextRows = Math.max(8, Math.floor(dims.rows))
      const last = lastSizeRef.current
      if (nextCols === last.cols && nextRows === last.rows) return
      lastSizeRef.current = { cols: nextCols, rows: nextRows }
      t.resize(nextCols, nextRows)
      if (activeCommand) {
        void window.api.terminalResize(activeCommand, nextCols, nextRows)
      }
    }
    const scheduleResize = () => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null
        onResize()
      })
    }
    scheduleResize()
    const resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(host)
    resizeObserverRef.current = resizeObserver
    window.addEventListener('resize', scheduleResize)

    const inputDisposable = terminal.onData((data) => {
      const activeCommand = activeCommandRef.current
      if (!activeCommand) return
      void window.api.terminalInput(activeCommand, data)
    })

    return () => {
      inputDisposable.dispose()
      offDataRef.current?.()
      offStatusRef.current?.()
      offDataRef.current = null
      offStatusRef.current = null
      activeCommandRef.current = ''
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      window.removeEventListener('resize', scheduleResize)
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      lastSizeRef.current = { cols: -1, rows: -1 }
    }
  }, [enabled, hostRef])

  useEffect(() => {
    if (!enabled) return
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return

    offDataRef.current?.()
    offStatusRef.current?.()
    offDataRef.current = null
    offStatusRef.current = null
    activeCommandRef.current = commandName || ''
    terminal.clear()
    terminal.reset()
    lastSizeRef.current = { cols: -1, rows: -1 }

    if (!commandName) {
      statusChangeRef.current('idle')
      terminal.writeln('请选择命令后连接会话。')
      return
    }

    const resizeNow = () => {
      const dims = fitAddon.proposeDimensions()
      if (!dims) return
      const nextCols = Math.max(20, Math.floor(dims.cols))
      const nextRows = Math.max(8, Math.floor(dims.rows))
      const last = lastSizeRef.current
      if (nextCols === last.cols && nextRows === last.rows) return
      lastSizeRef.current = { cols: nextCols, rows: nextRows }
      terminal.resize(nextCols, nextRows)
      void window.api.terminalResize(commandName, nextCols, nextRows)
    }

    const offData = window.api.onTerminalData((payload) => {
      if (payload.commandName !== commandName) return
      terminal.write(payload.data)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.commandName !== commandName) return
      statusChangeRef.current(payload.state)
      if (payload.state === 'idle' && typeof payload.exitCode === 'number') {
        terminal.write(`\r\n\r\n[会话已结束，状态码 ${payload.exitCode}]\r\n`)
      }
    })
    offDataRef.current = offData || null
    offStatusRef.current = offStatus || null

    void window.api
      .terminalStart(commandName)
      .then((result) => {
        if (activeCommandRef.current !== commandName) return
        if (result.buffer) terminal.write(result.buffer)
        statusChangeRef.current(result.state || 'running')
        resizeNow()
      })
      .catch((error) => {
        if (activeCommandRef.current !== commandName) return
        actionErrorRef.current(error instanceof Error ? error.message : String(error))
      })

    return () => {
      offDataRef.current?.()
      offStatusRef.current?.()
      offDataRef.current = null
      offStatusRef.current = null
    }
  }, [commandName, enabled])
}

function formatFavoritePreview(cmd: string): string {
  const single = cmd.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
  if (single.length <= 70) return single
  return `${single.slice(0, 68)}...`
}

function loadSplitRatio(): number {
  try {
    const raw = window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY)
    const value = Number(raw)
    if (Number.isFinite(value)) return Math.min(MAX_LEFT_RATIO, Math.max(MIN_LEFT_RATIO, value))
  } catch {
    // ignore storage errors
  }
  return 0.64
}

function loadConfirmBeforeExecute(): boolean {
  try {
    const raw = window.localStorage.getItem(CONFIRM_EXECUTE_STORAGE_KEY)
    if (raw === '0' || raw === 'false') return false
  } catch {
    // ignore storage errors
  }
  return true
}

function SessionBadge(props: { state: 'running' | 'idle_with_cache' | 'idle_empty' }) {
  const { state } = props
  const meta =
    state === 'running'
      ? { label: '运行中', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.45)', color: '#22c55e' }
      : state === 'idle_with_cache'
        ? { label: '已退出·有缓存', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.45)', color: '#f59e0b' }
        : { label: '无缓存', bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.45)', color: '#94a3b8' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: 1.4,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.color
      }}
    >
      {meta.label}
    </span>
  )
}

function getViewportWidth(): number {
  const docWidth = typeof document !== 'undefined' ? document.documentElement?.clientWidth || 0 : 0
  return docWidth > 0 ? docWidth : window.innerWidth
}

function resolveCompactLayout(width: number, prevCompact: boolean): boolean {
  if (prevCompact) return width <= COMPACT_EXIT_WIDTH
  return width <= COMPACT_ENTER_WIDTH
}
