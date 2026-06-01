import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { CommandConfig, QueryAiHistoryItem } from '../../shared/types'
import { buttonStyle, inputStyle } from '../lib/uiStyles'

type TimelineEntry = { key: string; at: number; role: 'user' | 'assistant'; content: string }

const CONFIRM_EXECUTE_STORAGE_KEY = 'query.ai.confirmExecute.v1'
const QUERY_TERMINAL_SOURCE = 'query'
const QUERY_TERMINAL_SESSION_PREFIX = 'query'
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
  active: boolean
  onTrackAction?: (featureKey: string, action: string, result?: 'success' | 'fail' | 'unknown') => void
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
    active,
    favoriteCommands,
    fillCommandFromFavorite,
    addFavoriteCommand,
    removeFavoriteCommand,
    onTrackAction
  } = props

  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const [showCommandPopover, setShowCommandPopover] = useState(false)
  const [autoFollowTimeline, setAutoFollowTimeline] = useState(true)
  const [showTerminalFullscreen, setShowTerminalFullscreen] = useState(false)
  const [terminalSessionState, setTerminalSessionState] = useState<'running' | 'idle'>('idle')
  const [pendingAiCommand, setPendingAiCommand] = useState('')
  const [confirmBeforeExecute, setConfirmBeforeExecute] = useState<boolean>(() => loadConfirmBeforeExecute())
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const inlineHostRef = useRef<HTMLDivElement | null>(null)
  const commandPopoverRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  const terminalPrinterRef = useRef<((content: string) => void) | null>(null)
  const printedChatCountRef = useRef(0)
  const printedStreamingNoticeRef = useRef(false)

  const liveAssistantText = isStreaming ? (streamingText.trim() || 'AI 正在分析中...') : ''
  const activeCommandText = (isStreaming ? streamingText : commandInput).trim()
  const queryTerminalSessionId = useMemo(() => createQueryTerminalSessionId(selectedCommand), [selectedCommand])
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
    try {
      window.localStorage.setItem(CONFIRM_EXECUTE_STORAGE_KEY, confirmBeforeExecute ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [confirmBeforeExecute])

  useEffect(() => {
    if (!autoFollowTimeline) return
    const el = timelineRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [timelineEntries, liveAssistantText, autoFollowTimeline])

  useEffect(() => {
    if (!showCommandPopover) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (commandPopoverRef.current && !commandPopoverRef.current.contains(target)) {
        setShowCommandPopover(false)
      }
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowCommandPopover(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [showCommandPopover])

  useTerminalSession({
    hostRef: inlineHostRef,
    commandName: selectedCommand,
    sessionId: queryTerminalSessionId,
    enabled: active,
    onTerminalReady: (printer) => {
      terminalPrinterRef.current = printer
      if (printer) {
        printedChatCountRef.current = chatHistory.length
        printedStreamingNoticeRef.current = false
      }
    },
    onStatusChange: setTerminalSessionState,
    onActionError
  })

  useEffect(() => {
    const printer = terminalPrinterRef.current
    if (!printer) return
    const start = printedChatCountRef.current
    if (chatHistory.length <= start) return
    const newEntries = chatHistory.slice(start)
    newEntries.forEach((entry) => {
      const line = formatTimelineTerminalLine(entry.role, entry.content)
      if (!line) return
      printer(line)
    })
    printedChatCountRef.current = chatHistory.length
    printedStreamingNoticeRef.current = false
  }, [chatHistory])

  useEffect(() => {
    const printer = terminalPrinterRef.current
    if (!printer) return
    if (!isStreaming) {
      printedStreamingNoticeRef.current = false
      return
    }
    if (printedStreamingNoticeRef.current) return
    printer(formatTerminalParagraphBlock('Assistant · streaming', '正在生成回复...'))
    printedStreamingNoticeRef.current = true
  }, [isStreaming])

  async function handleTranslate(): Promise<boolean> {
    if (!queryInput.trim() || isStreaming) return false
    onTrackAction?.('query.ai.translate', 'click', 'success')
    try {
      await translate()
      return true
    } catch (error) {
      onTrackAction?.('query.ai.translate', 'click', 'fail')
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
      onTrackAction?.('query.command.execute', 'run', 'success')
      await window.api.terminalStart(selectedCommand, { source: QUERY_TERMINAL_SOURCE, sessionId: queryTerminalSessionId })
      await window.api.terminalInput(selectedCommand, `${commandToRun}\n`, {
        source: QUERY_TERMINAL_SOURCE,
        sessionId: queryTerminalSessionId
      })
      setTerminalSessionState('running')
    } catch (error) {
      onTrackAction?.('query.command.execute', 'run', 'fail')
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
    setShowTerminalFullscreen((prev) => {
      const next = !prev
      onTrackAction?.('query.terminal.fullscreen', next ? 'open' : 'close', 'success')
      return next
    })
  }

  function toggleConfirmBeforeExecute(): void {
    setConfirmBeforeExecute((prev) => {
      const next = !prev
      onTrackAction?.('query.command.confirm_toggle', next ? 'enable' : 'disable', 'success')
      return next
    })
  }

  function handleAddFavorite(): void {
    const raw = (streamingText || commandInput).trim()
    if (!raw) return
    addFavoriteCommand()
    onTrackAction?.('query.favorite.add', 'click', 'success')
  }

  function handleRemoveFavorite(command: string): void {
    removeFavoriteCommand(command)
    onTrackAction?.('query.favorite.remove', 'click', 'success')
  }

  return (
    <div
      data-testid="log-analysis-page"
      style={{
        flex: 1,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--panel)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 20,
        padding: 8,
        overflow: 'hidden'
      }}
    >
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>终端面板</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedCommand ? `当前目标：${selectedCommand}` : '未选择命令会话'}</div>
              <SessionBadge state={terminalBadgeState} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>执行终端（{terminalSessionState === 'running' ? '运行中' : '空闲'}）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="log-analysis-confirm-before-execute"
                  checked={confirmBeforeExecute}
                  onChange={toggleConfirmBeforeExecute}
                />
                执行前确认
              </label>
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
          </div>
          <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--border-subtle)', borderRadius: 6, overflow: 'hidden', background: '#0d1117' }}>
            <div ref={inlineHostRef} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>
      </div>

      {(favoriteCommands.length > 0 || activeCommandText.trim()) && (
        <div style={{ ...SECTION_STYLE, padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>常用命令</span>
          {favoriteCommands.map((item) => (
            <button
              key={item}
              type="button"
              data-testid={`log-analysis-favorite-${item.slice(0, 24)}`}
              style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              onClick={() => fillCommandFromFavorite(item)}
            >
              {item.length > 40 ? `${item.slice(0, 40)}…` : item}
            </button>
          ))}
          {activeCommandText.trim() ? (
            <button
              type="button"
              data-testid="log-analysis-favorite-add"
              style={{ ...buttonStyle('outline'), padding: '2px 8px', fontSize: 11 }}
              onClick={handleAddFavorite}
            >
              收藏当前命令
            </button>
          ) : null}
          {favoriteCommands.length > 0 ? (
            <button
              type="button"
              data-testid="log-analysis-favorite-clear-last"
              style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}
              onClick={() => handleRemoveFavorite(favoriteCommands[0]!)}
            >
              移除最近收藏
            </button>
          ) : null}
        </div>
      )}

      <div style={{ ...SECTION_STYLE, padding: 8 }}>
        <div ref={commandPopoverRef} style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="选择命令"
            data-testid="log-analysis-open-command-popover"
            onClick={() => setShowCommandPopover((prev) => !prev)}
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              width: 24,
              height: 24,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0
            }}
            title={selectedCommand ? `当前命令：${selectedCommand}` : '选择命令'}
          >
            ⌘
          </button>
          {showCommandPopover ? (
            <div
              data-testid="log-analysis-command-popover"
              className="ui-popover"
              style={{
                position: 'absolute',
                bottom: 'calc(100% - 8px)',
                left: 8,
                width: 300,
                maxHeight: 280,
                overflowY: 'auto',
                borderRadius: 12,
                border: '1px solid var(--border-default)',
                background: 'var(--panel)',
                boxShadow: 'var(--shadow-hover)',
                padding: 8,
                zIndex: 20
              }}
            >
              <button
                type="button"
                data-testid="log-analysis-command-option-empty"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 6,
                  borderRadius: 8,
                  border: `1px solid ${selectedCommand ? 'var(--border-subtle)' : 'var(--accent)'}`,
                  background: selectedCommand ? 'var(--panel-soft)' : 'color-mix(in srgb, var(--accent) 12%, var(--panel))',
                  color: selectedCommand ? 'var(--muted)' : 'var(--text)',
                  padding: '7px 9px',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  selectCommand('')
                  setShowCommandPopover(false)
                }}
              >
                不选择命令
              </button>
              {commands.map((cmd) => (
                <button
                  key={cmd.name}
                  type="button"
                  data-testid={`log-analysis-command-option-${cmd.name}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 6,
                    borderRadius: 8,
                    border: `1px solid ${selectedCommand === cmd.name ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    background: selectedCommand === cmd.name ? 'color-mix(in srgb, var(--accent) 12%, var(--panel))' : 'var(--panel-soft)',
                    color: 'var(--text)',
                    padding: '7px 9px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11
                  }}
                  onClick={() => {
                    selectCommand(cmd.name)
                    setShowCommandPopover(false)
                  }}
                >
                  {cmd.name}
                </button>
              ))}
            </div>
          ) : null}
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
              paddingTop: 38,
              paddingRight: 80,
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
            aria-label="查看历史记录"
            title="查看历史记录"
            data-testid="log-analysis-open-history"
            onClick={() => setShowHistoryDialog(true)}
            style={{
              position: 'absolute',
              right: 42,
              bottom: 8,
              width: 28,
              height: 28,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--panel)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            🕘
          </button>
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

      {showHistoryDialog ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowHistoryDialog(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 92vw)', maxHeight: '72vh', overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>会话历史</div>
            <button
              type="button"
                data-testid="log-analysis-clear-chat"
                style={buttonStyle('muted')}
                onClick={clearChatHistory}
            >
                清空会话
              </button>
            </div>
            <div
              ref={timelineRef}
              data-testid="log-analysis-chat-history"
              onScroll={(e) => {
                const el = e.currentTarget
                const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
                setAutoFollowTimeline(distance < 40)
              }}
              style={{ ...SECTION_STYLE, flex: 1, minHeight: 0, overflow: 'auto', marginTop: 8, display: 'grid', alignContent: 'start', gap: 6, padding: 12 }}
            >
              {timelineEntries.length === 0 && !liveAssistantText ? (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>暂无会话记录。</div>
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
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={buttonStyle('muted')} onClick={() => setShowHistoryDialog(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {pendingAiCommand ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 105
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
  sessionId: string
  enabled: boolean
  onTerminalReady?: (printer: ((content: string) => void) | null) => void
  onStatusChange: (state: 'running' | 'idle') => void
  onActionError: (message: string) => void
}) {
  const { hostRef, commandName, sessionId, enabled, onTerminalReady, onStatusChange, onActionError } = args
  const terminalReadyRef = useRef(onTerminalReady)
  const statusChangeRef = useRef(onStatusChange)
  const actionErrorRef = useRef(onActionError)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: -1, rows: -1 })
  const activeCommandRef = useRef('')
  const activeSessionIdRef = useRef('')
  const offDataRef = useRef<(() => void) | null>(null)
  const offStatusRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    terminalReadyRef.current = onTerminalReady
  }, [onTerminalReady])

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
    terminalReadyRef.current?.((content) => {
      terminalRef.current?.write(content)
    })

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
        const activeSessionId = activeSessionIdRef.current.trim()
        void window.api.terminalResize(activeCommand, nextCols, nextRows, {
          sessionId: activeSessionId || undefined
        })
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
      const activeSessionId = activeSessionIdRef.current.trim()
      void window.api.terminalInput(activeCommand, data, {
        source: QUERY_TERMINAL_SOURCE,
        sessionId: activeSessionId || undefined
      })
    })

    return () => {
      inputDisposable.dispose()
      offDataRef.current?.()
      offStatusRef.current?.()
      offDataRef.current = null
      offStatusRef.current = null
      activeCommandRef.current = ''
      activeSessionIdRef.current = ''
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      window.removeEventListener('resize', scheduleResize)
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      lastSizeRef.current = { cols: -1, rows: -1 }
      terminalReadyRef.current?.(null)
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
    activeSessionIdRef.current = sessionId || ''
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
      void window.api.terminalResize(commandName, nextCols, nextRows, { sessionId: sessionId || undefined })
    }

    const offData = window.api.onTerminalData((payload) => {
      if (payload.commandName !== commandName) return
      if ((payload.sessionId || '') !== (sessionId || '')) return
      terminal.write(payload.data)
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.commandName !== commandName) return
      if ((payload.sessionId || '') !== (sessionId || '')) return
      statusChangeRef.current(payload.state)
      if (payload.state === 'idle' && typeof payload.exitCode === 'number') {
        terminal.write(`\r\n\r\n[会话已结束，状态码 ${payload.exitCode}]\r\n`)
      }
    })
    offDataRef.current = offData || null
    offStatusRef.current = offStatus || null

    void window.api
      .terminalStart(commandName, { source: QUERY_TERMINAL_SOURCE, sessionId: sessionId || undefined })
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
  }, [commandName, enabled, sessionId])
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

function formatTimelineTerminalLine(role: 'user' | 'assistant', content: string): string {
  const text = content.trim()
  if (!text) return ''
  const header = role === 'user' ? 'You' : 'Assistant'
  return formatTerminalParagraphBlock(header, text)
}

function createQueryTerminalSessionId(commandName: string): string {
  const normalized = commandName.trim()
  if (!normalized) return ''
  return `${QUERY_TERMINAL_SESSION_PREFIX}:${normalized}`
}

function formatTerminalParagraphBlock(header: string, rawContent: string): string {
  const normalized = rawContent.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  const bodyLines = normalized.split('\n')
  const framedLines = bodyLines.map((line) => `  ${line}`)
  return `\r\n${header}\r\n${framedLines.join('\r\n')}\r\n`
}

