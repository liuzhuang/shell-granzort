import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { buttonStyle, inputStyle } from '../lib/uiStyles'
import type { ThemeName } from '../styles/tokens'
import {
  getMonitoringSystemSkin
} from '../styles/monitoringTuiThemes'

interface MetricSnapshot {
  cpuUsage?: number
  load1m?: number
  memoryUsage?: number
  diskUsage?: number
  netRxKbps?: number
  netTxKbps?: number
}

interface MonitoringCommandInfo {
  name: string
  command: string
  sshKeyId?: string
}

interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  text: string
  at: number
  expandable?: boolean
}

const MONITORING_LAST_COMMAND_KEY = 'monitoring.lastCommand.v1'
const MONITORING_PINNED_COMMANDS_KEY = 'monitoring.pinnedCommands.v1'
const MONITORING_AI_AUTO_REFRESH_KEY = 'monitoring.aiAutoRefresh.v1'
const MONITORING_ENABLED_KEY = 'monitoring.enabled.v1'

/** 与指标行分离：一次抓取在终端输出中用起止标记包裹，便于从流中解析 */
const TOP_BLOCK_BEGIN = '__MON_TOP_BEGIN__'
const TOP_BLOCK_END = '__MON_TOP_END__'

export function MonitoringPage({
  commandName,
  commands,
  onSelectCommand,
  onActionError,
  onMonitoringEvent,
  theme
}: {
  commandName: string
  commands: MonitoringCommandInfo[]
  onSelectCommand: (name: string) => void
  onActionError: (message: string) => void
  onMonitoringEvent: (text: string) => void
  /** 与 TitleBar 一致：浅色 / 深色，与 TUI 风格组合为 6 套皮肤 */
  theme: ThemeName
}) {
  const aiTimerRef = useRef<number | null>(null)
  const metricPollTimerRef = useRef<number | null>(null)
  const actionErrorRef = useRef(onActionError)
  const monitorDispatchSeqRef = useRef(0)
  const monitoredCommandRef = useRef('')
  const traceIdRef = useRef<string>(createTraceId())
  const previousNetSnapshotRef = useRef<{ rxBytes: number; txBytes: number; at: number } | null>(null)
  const topCapturePhaseRef = useRef<'idle' | 'capturing'>('idle')
  const topLinesAccRef = useRef<string[]>([])
  const topLoadTimeoutRef = useRef<number | null>(null)
  /** 与切换离开本页一致：窗口隐藏（最小化、挂托盘等）时不跑定时采集 */
  const pageHostVisibleRef = useRef(typeof document !== 'undefined' && !document.hidden)
  const [sessionState, setSessionState] = useState<'running' | 'idle'>('idle')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [stripCollapsed, setStripCollapsed] = useState(false)
  const [expandedChatMetrics, setExpandedChatMetrics] = useState<Set<string>>(() => new Set())
  const [switchNotice, setSwitchNotice] = useState('')
  const [pinnedCommandNames, setPinnedCommandNames] = useState<string[]>(() => loadPinnedCommands())
  const [showAddCommandPopover, setShowAddCommandPopover] = useState(false)
  const addCommandPopoverRef = useRef<HTMLDivElement | null>(null)
  const chatByCommandRef = useRef<Map<string, ChatMessage[]>>(new Map())
  const metricCpuCacheRef = useRef<Map<string, number>>(new Map())
  const [deviceCpuCache, setDeviceCpuCache] = useState<Record<string, number>>({})
  const prevCommandRef = useRef('')
  const chatTimelineRef = useRef<HTMLDivElement | null>(null)
  const chatComposingRef = useRef(false)
  const [monitorEnabled, setMonitorEnabled] = useState<boolean>(() => loadMonitoringEnabled())
  const [aiAutoRefresh, setAiAutoRefresh] = useState<boolean>(() => loadAiAutoRefresh())
  const monitorEnabledRef = useRef(monitorEnabled)
  monitorEnabledRef.current = monitorEnabled
  const aiAutoRefreshRef = useRef(aiAutoRefresh)
  aiAutoRefreshRef.current = aiAutoRefresh
  const [latestMetrics, setLatestMetrics] = useState<MetricSnapshot>({})
  const [cpuSeries, setCpuSeries] = useState<number[]>([])
  const [loadSeries, setLoadSeries] = useState<number[]>([])
  const [memorySeries, setMemorySeries] = useState<number[]>([])
  const [diskSeries, setDiskSeries] = useState<number[]>([])
  const [netRxSeries, setNetRxSeries] = useState<number[]>([])
  const [netTxSeries, setNetTxSeries] = useState<number[]>([])
  const [topOutputLines, setTopOutputLines] = useState<string[]>([])
  const [topLoading, setTopLoading] = useState(false)
  const [topCapturedAt, setTopCapturedAt] = useState<number | null>(null)
  const [topLastKind, setTopLastKind] = useState<'process' | 'threads' | null>(null)
  const [latestChunk, setLatestChunk] = useState('')
  const [debugOpen, setDebugOpen] = useState(true)
  const [debugParsed, setDebugParsed] = useState<Record<string, unknown>>({})
  const [lastPollAt, setLastPollAt] = useState<number | null>(null)
  const [lastMetricAt, setLastMetricAt] = useState<number | null>(null)
  const [pollErrorCount, setPollErrorCount] = useState(0)
  const [lastPollError, setLastPollError] = useState('')
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [pageHostVisible, setPageHostVisible] = useState(() => typeof document !== 'undefined' && !document.hidden)
  const skin = useMemo(() => getMonitoringSystemSkin(theme), [theme])
  const inputSkin: CSSProperties = useMemo(
    () => ({
      ...inputStyle,
      background: skin.control.bg,
      border: `1px solid ${skin.control.border}`,
      color: skin.control.color
    }),
    [skin]
  )
  const toolbarSelectSkin: CSSProperties = useMemo(
    () => ({
      ...inputSkin,
      width: 'max-content',
      maxWidth: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      padding: '8px 14px'
    }),
    [inputSkin]
  )
  const btnMutedSkin: CSSProperties = useMemo(
    () => ({
      ...buttonStyle('muted'),
      background: skin.buttonMuted.bg,
      border: skin.buttonMuted.border,
      color: skin.buttonMuted.color
    }),
    [skin]
  )

  useEffect(() => {
    actionErrorRef.current = onActionError
  }, [onActionError])

  useEffect(() => {
    const sync = () => {
      const v = !document.hidden
      pageHostVisibleRef.current = v
      setPageHostVisible(v)
      if (v) setNowTick(Date.now())
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    if (!showAddCommandPopover) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addCommandPopoverRef.current && !addCommandPopoverRef.current.contains(target)) {
        setShowAddCommandPopover(false)
      }
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAddCommandPopover(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [showAddCommandPopover])

  const pinnedCommands = useMemo(
    () =>
      pinnedCommandNames
        .map((name) => commands.find((item) => item.name === name))
        .filter((item): item is MonitoringCommandInfo => Boolean(item)),
    [commands, pinnedCommandNames]
  )

  const availableCommandsToAdd = useMemo(
    () => commands.filter((item) => !pinnedCommandNames.includes(item.name)),
    [commands, pinnedCommandNames]
  )

  useEffect(() => {
    setPinnedCommandNames((prev) => {
      const filtered = prev.filter((name) => commands.some((item) => item.name === name))
      if (filtered.length !== prev.length) persistPinnedCommands(filtered)
      return filtered
    })
  }, [commands])

  useEffect(() => {
    persistPinnedCommands(pinnedCommandNames)
  }, [pinnedCommandNames])

  useEffect(() => {
    if (pinnedCommands.length === 0) {
      if (commandName) onSelectCommand('')
      return
    }
    const validInPinned = commandName && pinnedCommands.some((item) => item.name === commandName)
    if (validInPinned) return
    const saved = loadLastCommand()
    if (saved && pinnedCommands.some((item) => item.name === saved)) {
      onSelectCommand(saved)
      return
    }
    onSelectCommand(pinnedCommands[0]!.name)
  }, [commandName, pinnedCommands, onSelectCommand])

  useEffect(() => {
    if (!commandName) return
    persistLastCommand(commandName)
  }, [commandName])

  useEffect(() => {
    if (!commandName || !monitorEnabled || sessionState !== 'running' || !pageHostVisible) return
    if (metricPollTimerRef.current) window.clearInterval(metricPollTimerRef.current)
    const dispatchSnapshot = async () => {
      try {
        const metricCommand = buildLinuxMetricSnapshotCommand()
        monitorDispatchSeqRef.current += 1
        onMonitoringEvent(`监控执行#${monitorDispatchSeqRef.current}：${compactMonitoringCommand(metricCommand)}`)
        await window.api.terminalInput(commandName, `${metricCommand}\n`, { source: 'monitoring', traceId: traceIdRef.current })
        setLastPollAt(Date.now())
        setLastPollError('')
      } catch (error) {
        setPollErrorCount((prev) => prev + 1)
        setLastPollError(error instanceof Error ? error.message : String(error))
      }
    }
    void dispatchSnapshot()
    metricPollTimerRef.current = window.setInterval(() => {
      void dispatchSnapshot()
    }, 5000)
    return () => {
      if (metricPollTimerRef.current) window.clearInterval(metricPollTimerRef.current)
      metricPollTimerRef.current = null
    }
  }, [commandName, monitorEnabled, sessionState, pageHostVisible, onMonitoringEvent])

  useEffect(() => {
    if (!pageHostVisible) return
    const timer = window.setInterval(() => {
      setNowTick(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [pageHostVisible])

  useEffect(() => {
    if (pageHostVisible) return
    if (aiTimerRef.current) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
  }, [pageHostVisible])

  useEffect(() => {
    if (!commandName) return
    traceIdRef.current = createTraceId()
  }, [commandName])

  useEffect(() => {
    // 切换监控目标时清空上一命令的可视化状态，避免残留造成“串台”错觉。
    setSessionState('idle')
    setLatestChunk('')
    setLatestMetrics({})
    setCpuSeries([])
    setLoadSeries([])
    setMemorySeries([])
    setDiskSeries([])
    setNetRxSeries([])
    setNetTxSeries([])
    setTopOutputLines([])
    setTopLoading(false)
    setTopCapturedAt(null)
    setTopLastKind(null)
    setLastPollAt(null)
    setLastMetricAt(null)
    setPollErrorCount(0)
    setLastPollError('')
    monitorDispatchSeqRef.current = 0
    previousNetSnapshotRef.current = null
    topCapturePhaseRef.current = 'idle'
    topLinesAccRef.current = []
    if (topLoadTimeoutRef.current !== null) {
      window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = null
    }
  }, [commandName])

  useEffect(() => {
    return () => {
      if (topLoadTimeoutRef.current !== null) {
        window.clearTimeout(topLoadTimeoutRef.current)
        topLoadTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (typeof latestMetrics.cpuUsage === 'number' && commandName) {
      metricCpuCacheRef.current.set(commandName, latestMetrics.cpuUsage)
      setDeviceCpuCache((prev) => ({ ...prev, [commandName]: latestMetrics.cpuUsage! }))
    }
  }, [commandName, latestMetrics.cpuUsage])

  useEffect(() => {
    chatTimelineRef.current?.scrollTo({ top: chatTimelineRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatMessages, chatSending])

  const chatMessagesRef = useRef(chatMessages)
  chatMessagesRef.current = chatMessages

  useEffect(() => {
    if (!commandName) {
      setChatMessages([])
      return
    }
    const previous = prevCommandRef.current
    if (previous && previous !== commandName) {
      chatByCommandRef.current.set(previous, chatMessagesRef.current)
      setSwitchNotice(`已从 ${previous} 切换到 ${commandName} · 指标与 Chat 已隔离`)
    }
    prevCommandRef.current = commandName
    const restored = chatByCommandRef.current.get(commandName)
    if (restored && restored.length > 0) {
      setChatMessages(restored)
    } else {
      setChatMessages([
        {
          id: createChatId(),
          role: 'system',
          text: `已切换至 ${commandName}`,
          at: Date.now()
        }
      ])
    }
  }, [commandName])

  useEffect(() => {
    persistAiAutoRefresh(aiAutoRefresh)
  }, [aiAutoRefresh])

  useEffect(() => {
    persistMonitoringEnabled(monitorEnabled)
  }, [monitorEnabled])

  useEffect(() => {
    if (aiAutoRefresh) return
    if (aiTimerRef.current) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
  }, [aiAutoRefresh])

  useEffect(() => {
    const previousCommand = monitoredCommandRef.current
    if (previousCommand && previousCommand !== commandName) {
      void window.api.terminalStop(previousCommand).catch(() => undefined)
    }
    monitoredCommandRef.current = commandName

    if (!commandName) return
    if (!monitorEnabled) {
      setSessionState('idle')
      onMonitoringEvent(`监控已关闭：${commandName}`)
      void window.api.terminalStop(commandName).catch(() => undefined)
      return
    }
    let disposed = false
    void window.api
      .terminalStart(commandName, { source: 'monitoring', traceId: traceIdRef.current })
      .then((result) => {
        if (disposed) return
        setSessionState(result.state || 'running')
        onMonitoringEvent(`监控会话命令：${commandName}`)
      })
      .catch((error) => actionErrorRef.current(error instanceof Error ? error.message : String(error)))

    const offObserver = window.api.onTerminalObserver((payload) => {
      if (payload.commandName !== commandName) return
      setLatestChunk(payload.chunk)
      ingestTopSnapshotLines(payload.chunk)
      evaluateChunk(payload.chunk)
      scheduleAiInsight()
    })
    const offStatus = window.api.onTerminalStatus((payload) => {
      if (payload.commandName !== commandName) return
      setSessionState(payload.state)
    })

    return () => {
      disposed = true
      offObserver?.()
      offStatus?.()
      if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current)
    }
  }, [commandName, monitorEnabled, onMonitoringEvent])

  const metricLagSec = useMemo(() => {
    if (!lastMetricAt) return null
    return Math.floor((nowTick - lastMetricAt) / 1000)
  }, [lastMetricAt, nowTick])
  const monitorStatus = useMemo<'ok' | 'warn' | 'error' | 'idle'>(() => {
    if (!commandName || sessionState !== 'running') return 'idle'
    if (lastPollError) return 'error'
    if (metricLagSec === null) return 'warn'
    return metricLagSec <= 12 ? 'ok' : 'warn'
  }, [commandName, sessionState, lastPollError, metricLagSec])

  function ingestTopSnapshotLines(chunk: string): void {
    const segments = chunk.split(/\r?\n/)
    for (const raw of segments) {
      const line = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
      const trimmedEnd = line.trimEnd()

      if (topCapturePhaseRef.current === 'idle') {
        if (trimmedEnd.includes(TOP_BLOCK_BEGIN)) {
          topCapturePhaseRef.current = 'capturing'
          topLinesAccRef.current = []
          const after = trimmedEnd.split(TOP_BLOCK_BEGIN)[1] ?? ''
          const rest = after.trimStart()
          if (rest.length > 0 && !rest.includes(TOP_BLOCK_END)) topLinesAccRef.current.push(rest)
          else if (rest.includes(TOP_BLOCK_END)) {
            const body = rest.split(TOP_BLOCK_END)[0]?.trimEnd() ?? ''
            if (body.length > 0) topLinesAccRef.current.push(body)
            finalizeTopSnapshot()
          }
        }
        continue
      }

      if (trimmedEnd.includes(TOP_BLOCK_END)) {
        const before = trimmedEnd.split(TOP_BLOCK_END)[0] ?? ''
        if (before.trim().length > 0) topLinesAccRef.current.push(before.trimEnd())
        finalizeTopSnapshot()
        continue
      }

      if (trimmedEnd.startsWith('__MON_METRIC__')) continue

      topLinesAccRef.current.push(trimmedEnd)
    }
  }

  function finalizeTopSnapshot(): void {
    setTopOutputLines([...topLinesAccRef.current])
    topLinesAccRef.current = []
    topCapturePhaseRef.current = 'idle'
    setTopLoading(false)
    setTopCapturedAt(Date.now())
    if (topLoadTimeoutRef.current !== null) {
      window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = null
    }
  }

  async function runTopSnapshot(mode: 'process' | 'threads'): Promise<void> {
    if (!commandName) return
    const topCmd = mode === 'threads' ? 'top -bn1 -H' : 'top -bn1'
    const cmd = `echo '${TOP_BLOCK_BEGIN}'; COLUMNS=240 LC_ALL=C ${topCmd} 2>/dev/null | head -n 40; echo '${TOP_BLOCK_END}'`
    try {
      await window.api.terminalStart(commandName, { source: 'monitoring', traceId: traceIdRef.current })
      setTopLastKind(mode)
      setTopLoading(true)
      onMonitoringEvent(`监控执行：${compactMonitoringCommand(cmd)}`)
      if (topLoadTimeoutRef.current !== null) window.clearTimeout(topLoadTimeoutRef.current)
      topLoadTimeoutRef.current = window.setTimeout(() => {
        topLoadTimeoutRef.current = null
        if (topCapturePhaseRef.current === 'capturing') {
          topCapturePhaseRef.current = 'idle'
          topLinesAccRef.current = []
          setTopLoading(false)
        }
      }, 15000)
      await window.api.terminalInput(commandName, `${cmd}\n`, { source: 'monitoring', traceId: traceIdRef.current })
    } catch (error) {
      setTopLoading(false)
      if (topLoadTimeoutRef.current !== null) {
        window.clearTimeout(topLoadTimeoutRef.current)
        topLoadTimeoutRef.current = null
      }
      onActionError(error instanceof Error ? error.message : String(error))
    }
  }

  function evaluateChunk(chunk: string): void {
    const parsed = extractMetrics(chunk, previousNetSnapshotRef.current)
    const metrics = parsed.metrics
    previousNetSnapshotRef.current = parsed.nextNetSnapshot
    setDebugParsed({
      source: parsed.source,
      metrics,
      at: Date.now()
    })
    if (parsed.source === 'linux_metric_line') {
      setLastMetricAt(Date.now())
      setPollErrorCount(0)
    }
    setLatestMetrics(metrics)
    if (typeof metrics.cpuUsage === 'number') setCpuSeries((prev) => [...prev, metrics.cpuUsage!].slice(-42))
    if (typeof metrics.load1m === 'number') setLoadSeries((prev) => [...prev, metrics.load1m!].slice(-42))
    if (typeof metrics.memoryUsage === 'number') setMemorySeries((prev) => [...prev, metrics.memoryUsage!].slice(-42))
    if (typeof metrics.diskUsage === 'number') setDiskSeries((prev) => [...prev, metrics.diskUsage!].slice(-42))
    if (typeof metrics.netRxKbps === 'number') setNetRxSeries((prev) => [...prev, metrics.netRxKbps!].slice(-42))
    if (typeof metrics.netTxKbps === 'number') setNetTxSeries((prev) => [...prev, metrics.netTxKbps!].slice(-42))
  }

  /** 防抖后触发与手动「拉取并分析」相同的完整链路（非仅重绘 UI）。 */
  function scheduleAiInsight(): void {
    if (!monitorEnabledRef.current) return
    if (!aiAutoRefreshRef.current) return
    if (!pageHostVisibleRef.current) return
    if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current)
    aiTimerRef.current = window.setTimeout(() => {
      void refreshAiInsight()
    }, 1000)
  }

  function pushChatMessage(message: Omit<ChatMessage, 'id'> & { id?: string }): void {
    const entry: ChatMessage = {
      id: message.id ?? createChatId(),
      role: message.role,
      text: message.text.trim() || '（空结果）',
      at: message.at,
      expandable: message.expandable
    }
    setChatMessages((prev) => {
      const next = [...prev, entry]
      if (commandName) chatByCommandRef.current.set(commandName, next)
      return next
    })
  }

  async function sendChatMessage(): Promise<void> {
    const text = chatInput.trim()
    if (!text || !commandName || chatSending || aiLoading) return
    pushChatMessage({ role: 'user', text, at: Date.now() })
    setChatInput('')
    setChatSending(true)
    try {
      const { text: bufferText } = await window.api.terminalGetBuffer(commandName)
      const sessionLogs = sanitizeLines(bufferText).slice(-140)
      const history = chatMessages
        .filter((item): item is ChatMessage & { role: 'user' | 'assistant' } => item.role === 'user' || item.role === 'assistant')
        .slice(-12)
        .map((item) => ({
          role: item.role,
          content: item.text
        }))
      const result = await window.api.queryAiChat({
        requestId: `monitoring-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input: text,
        history,
        selectedCommand: commandName,
        sessionLogs,
        queryOutputLines: []
      })
      pushChatMessage({
        role: 'assistant',
        text: result.answer.trim() || '未提取到有效回复。',
        at: Date.now(),
        expandable: true
      })
    } catch (error) {
      pushChatMessage({
        role: 'assistant',
        text: error instanceof Error ? error.message : String(error),
        at: Date.now()
      })
    } finally {
      setChatSending(false)
    }
  }

  /**
   * 完整一次分析：先 IPC `terminal:get-buffer` 拉主进程缓冲，再 IPC `query:ai-chat` 调模型。
   * 无可用行时跳过 LLM，但仍已执行缓冲拉取。
   */
  async function refreshAiInsight(): Promise<void> {
    if (!commandName) return
    setAiLoading(true)
    try {
      const { text } = await window.api.terminalGetBuffer(commandName)
      const lines = sanitizeLines(text).slice(-140)
      if (lines.length === 0) {
        pushChatMessage({
          role: 'assistant',
          text: '当前监控流暂无可分析输出（已拉取缓冲区，无可送模型的内容）。',
          at: Date.now()
        })
        return
      }
      const result = await window.api.queryAiChat({
        requestId: `monitoring-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input:
          '你是 AI 监控助手。请结合下方会话输出，输出最多 3 条简洁结论：是否存在异常或风险、严重度、建议下一步。若需告警式提示，请明确写出「告警」或风险点。',
        history: [],
        selectedCommand: commandName,
        sessionLogs: lines,
        queryOutputLines: []
      })
      pushChatMessage({
        role: 'assistant',
        text: result.answer.trim() || '未提取到有效洞察。',
        at: Date.now(),
        expandable: true
      })
    } catch {
      pushChatMessage({
        role: 'assistant',
        text: buildFallbackInsight(latestChunk),
        at: Date.now(),
        expandable: true
      })
    } finally {
      setAiLoading(false)
    }
  }

  function addPinnedCommand(name: string): void {
    const normalized = name.trim()
    if (!normalized) return
    if (!commands.some((item) => item.name === normalized)) return
    setPinnedCommandNames((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]))
    onSelectCommand(normalized)
    setShowAddCommandPopover(false)
  }

  function removePinnedCommand(name: string): void {
    setPinnedCommandNames((prev) => {
      const next = prev.filter((item) => item !== name)
      if (commandName === name) onSelectCommand(next[0] ?? '')
      return next
    })
  }

  const activeCommand = pinnedCommands.find((item) => item.name === commandName) ?? commands.find((item) => item.name === commandName)
  const activeDeviceMeta = activeCommand ? inferDeviceMeta(activeCommand) : null
  const stripItems: Array<[string, string]> = [
    ['CPU', fmtPct(latestMetrics.cpuUsage)],
    ['Load', fmtLoad(latestMetrics.load1m)],
    ['内存', fmtPct(latestMetrics.memoryUsage)],
    ['磁盘', fmtPct(latestMetrics.diskUsage)],
    ['Rx', fmtKbps(latestMetrics.netRxKbps)],
    ['Tx', fmtKbps(latestMetrics.netTxKbps)]
  ]

  function toggleChatMetrics(messageId: string): void {
    setExpandedChatMetrics((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  return (
    <div
      data-testid="monitoring-page"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: skin.shell.bg,
        color: skin.shell.text,
        border: `1px solid ${skin.shell.border}`,
        borderRadius: 12,
        overflow: 'hidden'
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)' }}>
        <aside
          data-testid="monitoring-device-rail"
          style={{
            background: skin.panelDeep.bg,
            borderRight: `1px solid ${skin.shell.border}`,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          <div style={{ padding: '14px 12px 10px', borderBottom: `1px solid ${skin.shell.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>监控设备</div>
            <div style={{ fontSize: 11, color: skin.meta, marginTop: 4 }}>点击切换 · 状态实时</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'grid', gap: 4, alignContent: 'start' }}>
            {pinnedCommands.length === 0 ? (
              <div style={{ fontSize: 11, color: skin.meta, padding: 8, lineHeight: 1.6 }}>
                尚未添加监控设备。点击下方「添加命令」从命令列表中选择。
              </div>
            ) : (
              pinnedCommands.map((item) => {
                const meta = inferDeviceMeta(item)
                const active = item.name === commandName
                const cachedCpu = deviceCpuCache[item.name] ?? metricCpuCacheRef.current.get(item.name) ?? 0
                return (
                  <div
                    key={item.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 4,
                      borderRadius: 8,
                      border: active ? `1px solid ${skin.statusDot.ok}` : '1px solid transparent',
                      background: active ? skin.panelInset.bg : 'transparent'
                    }}
                  >
                    <button
                      type="button"
                      data-testid={`monitoring-device-item-${item.name}`}
                      onClick={() => onSelectCommand(item.name)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: 8,
                        alignItems: 'center',
                        padding: '6px',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background: 'transparent',
                        color: skin.shell.text,
                        textAlign: 'left',
                        fontFamily: 'inherit'
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{meta.icon}</span>
                      <span style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: skin.meta, marginTop: 2 }}>{meta.label}</div>
                      </span>
                      <span
                        aria-hidden
                        style={{
                          width: 36,
                          height: 4,
                          borderRadius: 999,
                          background: skin.panelInset.border,
                          overflow: 'hidden',
                          display: 'inline-block'
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            height: '100%',
                            width: `${Math.max(0, Math.min(100, cachedCpu))}%`,
                            background: skin.statusDot.ok
                          }}
                        />
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`移除 ${item.name}`}
                      data-testid={`monitoring-device-remove-${item.name}`}
                      onClick={() => removePinnedCommand(item.name)}
                      style={{
                        ...btnMutedSkin,
                        padding: '2px 6px',
                        fontSize: 10,
                        lineHeight: 1,
                        flexShrink: 0
                      }}
                      title="从监控列表移除"
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>
          <div
            ref={addCommandPopoverRef}
            style={{
              padding: 10,
              borderTop: `1px solid ${skin.shell.border}`,
              position: 'relative'
            }}
          >
            <button
              type="button"
              data-testid="monitoring-add-command-button"
              onClick={() => setShowAddCommandPopover((prev) => !prev)}
              style={{
                ...btnMutedSkin,
                width: '100%',
                fontSize: 11,
                color: skin.subtitle
              }}
            >
              + 添加命令
            </button>
            {showAddCommandPopover ? (
              <div
                data-testid="monitoring-add-command-popover"
                className="ui-popover"
                style={{
                  position: 'absolute',
                  left: 10,
                  right: 10,
                  bottom: 'calc(100% + 8px)',
                  maxHeight: 260,
                  overflowY: 'auto',
                  borderRadius: 10,
                  border: `1px solid ${skin.shell.border}`,
                  background: skin.panelInset.bg,
                  boxShadow: 'var(--shadow-hover)',
                  padding: 8,
                  zIndex: 20
                }}
              >
                {commands.length === 0 ? (
                  <div style={{ fontSize: 11, color: skin.meta, padding: 6 }}>暂无可用命令，请先在命令列表添加。</div>
                ) : availableCommandsToAdd.length === 0 ? (
                  <div style={{ fontSize: 11, color: skin.meta, padding: 6 }}>所有命令均已添加到监控列表。</div>
                ) : (
                  availableCommandsToAdd.map((item) => {
                    const meta = inferDeviceMeta(item)
                    return (
                      <button
                        key={item.name}
                        type="button"
                        data-testid={`monitoring-add-command-option-${item.name}`}
                        onClick={() => addPinnedCommand(item.name)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          marginBottom: 6,
                          borderRadius: 8,
                          border: `1px solid ${skin.shell.border}`,
                          background: skin.panelDeep.bg,
                          color: skin.shell.text,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          fontFamily: 'inherit'
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: skin.meta, marginTop: 2 }}>{meta.label}</div>
                      </button>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
        </aside>

        <main style={{ minWidth: 0, display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderBottom: `1px solid ${skin.shell.border}`,
              background: skin.panelInset.bg
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>AI监控 · {commandName || '未选择设备'}</div>
              <div style={{ fontSize: 11, color: skin.meta, marginTop: 3 }}>
                {activeDeviceMeta ? `${activeDeviceMeta.label} · ` : ''}
                {sessionState === 'running' ? '采集中' : '空闲'} · 切换设备时不串会话
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: skin.meta, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span>
                  采集：
                  {monitorStatus === 'ok' ? '正常' : monitorStatus === 'warn' ? '延迟' : monitorStatus === 'error' ? '异常' : '未启动'}
                </span>
                <span>派发：{lastPollAt ? formatTime(lastPollAt) : '--'}</span>
                <span>入库：{lastMetricAt ? formatTime(lastMetricAt) : '--'}</span>
                {metricLagSec !== null ? <span>延迟：{metricLagSec}s</span> : null}
              </div>
              {lastPollError ? <div style={{ marginTop: 2, fontSize: 10, color: skin.error }}>最近错误：{lastPollError}</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <select
                data-testid="monitoring-enabled-toggle"
                value={monitorEnabled ? 'on' : 'off'}
                onChange={(e) => setMonitorEnabled(e.target.value === 'on')}
                style={toolbarSelectSkin}
                title="监控开关"
              >
                <option value="on">监控：开启</option>
                <option value="off">监控：关闭</option>
              </select>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: skin.meta,
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={aiAutoRefresh}
                  onChange={(e) => setAiAutoRefresh(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: skin.shell.text }}
                />
                自动 AI
              </label>
              <button
                type="button"
                style={{ ...btnMutedSkin, fontSize: 11 }}
                onClick={() => void refreshAiInsight()}
                disabled={aiLoading || !commandName || !monitorEnabled}
                data-testid="monitoring-analyze-button"
              >
                {aiLoading ? '请求中…' : '拉取并分析'}
              </button>
            </div>
          </div>

          <div style={{ borderBottom: `1px solid ${skin.shell.border}`, background: skin.panelDeep.bg }}>
            <button
              type="button"
              onClick={() => setStripCollapsed((prev) => !prev)}
              style={{
                width: '100%',
                padding: '6px 16px',
                border: 'none',
                borderBottom: stripCollapsed ? 'none' : `1px solid ${skin.shell.border}`,
                background: 'transparent',
                color: skin.meta,
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'inherit'
              }}
            >
              <span>指标概览（6 项）</span>
              <span>{stripCollapsed ? '展开 ▼' : '收起 ▲'}</span>
            </button>
            {!stripCollapsed ? (
              <div
                data-testid="monitoring-metric-strip"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                  gap: 8,
                  padding: '10px 16px'
                }}
              >
                {stripItems.map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      border: `1px solid ${skin.shell.border}`,
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: skin.panelInset.bg
                    }}
                  >
                    <div style={{ fontSize: 9, color: skin.meta, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: skin.panelDeep.bg }}>
            <div
              style={{
                padding: '8px 16px',
                borderBottom: `1px solid ${skin.shell.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: skin.meta
              }}
            >
              <span>Chat 解读 · 自动摘要 + 追问</span>
              <span>{commandName ? `当前：${commandName}` : '请从左侧选择设备'}</span>
            </div>

            <div
              ref={chatTimelineRef}
              data-testid="monitoring-chat-timeline"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '14px 16px',
                display: 'grid',
                gap: 10,
                alignContent: 'start'
              }}
            >
              {!commandName ? (
                <div style={{ justifySelf: 'center', fontSize: 12, color: skin.meta, padding: '24px 0' }}>
                  请从左侧选择要监控的设备
                </div>
              ) : chatMessages.length === 0 ? (
                <div style={{ fontSize: 11, color: skin.meta }}>
                  {aiAutoRefresh ? '等待首次自动分析…' : '可点击「拉取并分析」或输入问题开始对话。'}
                </div>
              ) : (
                chatMessages.map((message) => {
                  if (message.role === 'system') {
                    return (
                      <div
                        key={message.id}
                        style={{
                          justifySelf: 'center',
                          fontSize: 10,
                          color: skin.meta,
                          background: skin.panelInset.bg,
                          borderRadius: 999,
                          padding: '5px 12px'
                        }}
                      >
                        {message.text}
                      </div>
                    )
                  }
                  const expanded = expandedChatMetrics.has(message.id)
                  return (
                    <div
                      key={message.id}
                      style={{
                        justifySelf: message.role === 'user' ? 'end' : 'start',
                        maxWidth: '78%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        fontSize: 12,
                        lineHeight: 1.55,
                        background: message.role === 'user' ? skin.panelRaised.bg : skin.panelInset.bg,
                        border: `1px solid ${message.role === 'user' ? skin.panelRaised.border : skin.shell.border}`,
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      <div style={{ fontSize: 10, color: skin.meta, marginBottom: 4 }}>{formatInsightCollectedAt(message.at)}</div>
                      {message.text}
                      {message.expandable && commandName ? (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleChatMetrics(message.id)}
                            style={{
                              marginTop: 8,
                              fontSize: 10,
                              color: skin.subtitle,
                              cursor: 'pointer',
                              border: 'none',
                              background: 'none',
                              padding: 0,
                              fontFamily: 'inherit'
                            }}
                          >
                            {expanded ? '收起指标 ▴' : '展开指标详情 ▾'}
                          </button>
                          {expanded ? (
                            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                              <div style={{ border: `1px solid ${skin.shell.border}`, borderRadius: 6, padding: 6, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                                <span style={{ display: 'block', color: skin.meta, fontSize: 9 }}>CPU</span>
                                {fmtPct(latestMetrics.cpuUsage)}
                              </div>
                              <div style={{ border: `1px solid ${skin.shell.border}`, borderRadius: 6, padding: 6, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                                <span style={{ display: 'block', color: skin.meta, fontSize: 9 }}>内存</span>
                                {fmtPct(latestMetrics.memoryUsage)}
                              </div>
                              <div style={{ border: `1px solid ${skin.shell.border}`, borderRadius: 6, padding: 6, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                                <span style={{ display: 'block', color: skin.meta, fontSize: 9 }}>Load</span>
                                {fmtLoad(latestMetrics.load1m)}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  )
                })
              )}
              {chatSending || aiLoading ? (
                <div style={{ justifySelf: 'start', fontSize: 11, color: skin.meta }}>AI 正在分析中…</div>
              ) : null}
            </div>

            {switchNotice ? (
              <div
                data-testid="monitoring-switch-notice"
                style={{
                  margin: '0 16px 8px',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${skin.statusDot.ok}`,
                  background: skin.panelInset.bg,
                  fontSize: 11,
                  color: skin.subtitle
                }}
              >
                ✓ {switchNotice}
              </div>
            ) : null}

            <div
              style={{
                padding: '10px 16px 14px',
                borderTop: `1px solid ${skin.shell.border}`,
                background: skin.panelInset.bg,
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                alignItems: 'end'
              }}
            >
              <textarea
                data-testid="monitoring-chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onCompositionStart={() => {
                  chatComposingRef.current = true
                }}
                onCompositionEnd={() => {
                  chatComposingRef.current = false
                }}
                placeholder="有问题，尽管问"
                disabled={!commandName || chatSending || aiLoading}
                rows={2}
                style={{
                  ...inputSkin,
                  width: '100%',
                  minHeight: 44,
                  resize: 'none',
                  fontSize: 12,
                  lineHeight: 1.45
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    const native = e.nativeEvent as KeyboardEvent
                    const isImeComposing =
                      chatComposingRef.current || native.isComposing || (native as unknown as { keyCode?: number }).keyCode === 229
                    if (isImeComposing) return
                    e.preventDefault()
                    void sendChatMessage()
                  }
                }}
              />
              <button
                type="button"
                data-testid="monitoring-chat-send"
                style={{ ...btnMutedSkin, fontSize: 12 }}
                disabled={!commandName || chatSending || aiLoading || !chatInput.trim()}
                onClick={() => void sendChatMessage()}
              >
                发送
              </button>
            </div>

            <details style={{ borderTop: `1px solid ${skin.shell.border}`, background: skin.panelInset.bg }}>
              <summary style={{ padding: '8px 16px', fontSize: 11, color: skin.meta, cursor: 'pointer' }}>高级：top 快照与调试</summary>
              <div style={{ padding: '0 16px 14px', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" style={btnMutedSkin} disabled={!commandName || !monitorEnabled || topLoading} onClick={() => void runTopSnapshot('process')}>
                    {topLoading ? '抓取中…' : '抓取进程'}
                  </button>
                  <button type="button" style={btnMutedSkin} disabled={!commandName || !monitorEnabled || topLoading} onClick={() => void runTopSnapshot('threads')}>
                    {topLoading ? '抓取中…' : '抓取线程'}
                  </button>
                </div>
                {topOutputLines.length > 0 ? (
                  <pre
                    style={{
                      margin: 0,
                      maxHeight: 160,
                      overflow: 'auto',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: skin.panelInset.text,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {topOutputLines.join('\n')}
                  </pre>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>原始解析值调试面板</span>
                  <button type="button" style={btnMutedSkin} onClick={() => setDebugOpen((prev) => !prev)}>
                    {debugOpen ? '折叠' : '展开'}
                  </button>
                </div>
                {debugOpen ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 10, color: skin.panelInset.text }}>
                      {JSON.stringify(debugParsed, null, 2)}
                    </pre>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        maxHeight: 120,
                        overflow: 'auto',
                        color: skin.panelInset.text
                      }}
                    >
                      {latestChunk || '暂无采样片段'}
                    </pre>
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        </main>
      </div>
    </div>
  )
}

function inferDeviceMeta(command: MonitoringCommandInfo): { label: string; icon: string } {
  const isRemote = Boolean(command.sshKeyId) || /\bssh\b/i.test(command.command)
  return isRemote ? { label: '远程 SSH', icon: '🌐' } : { label: '本地电脑', icon: '💻' }
}

function createChatId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extractMetrics(
  chunk: string,
  previousNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
): {
  source: 'linux_metric_line' | 'regex_fallback'
  metrics: MetricSnapshot
  nextNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
} {
  const metricLine = chunk
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())
    .find((line) => line.startsWith('__MON_METRIC__'))
  if (metricLine) {
    const parsed = parseLinuxMetricLine(metricLine, previousNetSnapshot)
    const text = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    let metrics = parsed.metrics
    if (typeof metrics.cpuUsage !== 'number') {
      const cpuFallback = matchPct(
        text,
        [/cpu[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)\s*%/i, /(\d{1,3}(?:\.\d+)?)\s*%\s*id/i],
        (value, raw) => (/%\s*id/i.test(raw) ? Math.max(0, 100 - value) : value)
      )
      if (typeof cpuFallback === 'number') metrics = { ...metrics, cpuUsage: cpuFallback }
    }
    return { source: 'linux_metric_line', metrics, nextNetSnapshot: parsed.nextNetSnapshot }
  }

  const text = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  const cpuUsage = matchPct(text, [/cpu[^0-9]{0,10}(\d{1,3}(?:\.\d+)?)\s*%/i, /(\d{1,3}(?:\.\d+)?)\s*%\s*id/i], (value, raw) =>
    /%\s*id/i.test(raw) ? Math.max(0, 100 - value) : value
  )
  const load1m = matchNum(text, [/load average[:\s]+(\d+(?:\.\d+)?)/i, /load[:\s]+(\d+(?:\.\d+)?)/i])
  const memoryUsage = matchPct(text, [/mem(?:ory)?[^0-9]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i, /ram[^0-9]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i])
  const diskUsage = matchPct(text, [/(\d{1,3})%\s+\/[a-z0-9/_-]+/i])
  const netRxKbps = matchKbps(text, [/rx[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i, /receive[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i])
  const netTxKbps = matchKbps(text, [/tx[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i, /send[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|gb\/s)/i])
  return {
    source: 'regex_fallback',
    metrics: { cpuUsage, load1m, memoryUsage, diskUsage, netRxKbps, netTxKbps },
    nextNetSnapshot: previousNetSnapshot
  }
}

function matchPct(text: string, patterns: RegExp[], transform?: (value: number, raw: string) => number): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1]) {
      const value = Number(hit[1])
      if (Number.isFinite(value)) {
        const next = transform ? transform(value, hit[0]) : value
        return Math.max(0, Math.min(100, next))
      }
    }
  }
  return undefined
}

function matchNum(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1]) {
      const value = Number(hit[1])
      if (Number.isFinite(value)) return value
    }
  }
  return undefined
}

function matchKbps(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit?.[1] && hit?.[2]) {
      const value = Number(hit[1])
      const unit = hit[2].toLowerCase()
      if (!Number.isFinite(value)) continue
      if (unit === 'kb/s') return value
      if (unit === 'mb/s') return value * 1024
      if (unit === 'gb/s') return value * 1024 * 1024
    }
  }
  return undefined
}

function parseLinuxMetricLine(
  line: string,
  previousNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
): {
  metrics: MetricSnapshot
  nextNetSnapshot: { rxBytes: number; txBytes: number; at: number } | null
} {
  const cpuUsage = parseKeyNumber(line, 'cpu')
  const load1m = parseKeyNumber(line, 'load')
  const memoryUsage = parseKeyNumber(line, 'mem')
  const diskUsage = parseKeyNumber(line, 'disk')
  const netRaw = parseKeyString(line, 'net')
  let netRxKbps: number | undefined
  let netTxKbps: number | undefined
  let nextNetSnapshot = previousNetSnapshot
  if (netRaw && netRaw.includes(',')) {
    const [rxText, txText] = netRaw.split(',')
    const rxBytes = Number(rxText)
    const txBytes = Number(txText)
    const now = Date.now()
    if (Number.isFinite(rxBytes) && Number.isFinite(txBytes)) {
      if (previousNetSnapshot && now > previousNetSnapshot.at) {
        const elapsedSec = (now - previousNetSnapshot.at) / 1000
        if (elapsedSec > 0.3) {
          netRxKbps = Math.max(0, (rxBytes - previousNetSnapshot.rxBytes) / 1024 / elapsedSec)
          netTxKbps = Math.max(0, (txBytes - previousNetSnapshot.txBytes) / 1024 / elapsedSec)
        }
      }
      nextNetSnapshot = { rxBytes, txBytes, at: now }
    }
  }
  return {
    metrics: { cpuUsage, load1m, memoryUsage, diskUsage, netRxKbps, netTxKbps },
    nextNetSnapshot
  }
}

function parseKeyNumber(line: string, key: string): number | undefined {
  const hit = line.match(new RegExp(`${key}=([0-9]+(?:\\.[0-9]+)?)`, 'i'))
  if (!hit?.[1]) return undefined
  const value = Number(hit[1])
  return Number.isFinite(value) ? value : undefined
}

function parseKeyString(line: string, key: string): string | undefined {
  const hit = line.match(new RegExp(`${key}=([^\\s]+)`, 'i'))
  return hit?.[1]
}

function sanitizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trimEnd())
    .filter((line) => line.length > 0)
}

function buildFallbackInsight(chunk: string): string {
  const text = chunk.toLowerCase()
  const rows: string[] = []
  if (/error|exception|fatal/.test(text)) rows.push('- 发现错误关键词，建议查看最近错误栈。')
  if (/timeout|connection reset/.test(text)) rows.push('- 发现超时/连接异常，建议检查网络与下游服务。')
  if (/oom|out of memory/.test(text)) rows.push('- 发现潜在内存压力，建议检查内存占用与限额。')
  if (rows.length === 0) rows.push('- 未发现高风险关键词，建议继续观察。')
  return rows.slice(0, 3).join('\n')
}

function fmtPct(value?: number): string {
  return typeof value === 'number' ? `${value.toFixed(0)}%` : '--'
}

function fmtLoad(value?: number): string {
  return typeof value === 'number' ? value.toFixed(2) : '--'
}

function fmtKbps(value?: number): string {
  if (typeof value !== 'number') return '--'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} GB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(2)} MB/s`
  return `${value.toFixed(0)} KB/s`
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString()
}

/** AI 分析完成时刻，用于列表极小号时间戳 */
function formatInsightCollectedAt(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return String(at)
  }
}

function persistLastCommand(commandName: string): void {
  try {
    window.localStorage.setItem(MONITORING_LAST_COMMAND_KEY, commandName)
  } catch {
    // ignore storage failures
  }
}

function loadPinnedCommands(): string[] {
  try {
    const raw = window.localStorage.getItem(MONITORING_PINNED_COMMANDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function persistPinnedCommands(names: string[]): void {
  try {
    window.localStorage.setItem(MONITORING_PINNED_COMMANDS_KEY, JSON.stringify(names))
  } catch {
    // ignore storage failures
  }
}

function loadLastCommand(): string {
  try {
    return window.localStorage.getItem(MONITORING_LAST_COMMAND_KEY) || ''
  } catch {
    return ''
  }
}

function loadAiAutoRefresh(): boolean {
  try {
    const raw = window.localStorage.getItem(MONITORING_AI_AUTO_REFRESH_KEY)
    if (raw === '0' || raw === 'false') return false
    return true
  } catch {
    return true
  }
}

function loadMonitoringEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(MONITORING_ENABLED_KEY)
    if (raw === '0' || raw === 'false') return false
    return true
  } catch {
    return true
  }
}

function persistAiAutoRefresh(value: boolean): void {
  try {
    window.localStorage.setItem(MONITORING_AI_AUTO_REFRESH_KEY, value ? '1' : '0')
  } catch {
    // ignore storage failures
  }
}

function persistMonitoringEnabled(value: boolean): void {
  try {
    window.localStorage.setItem(MONITORING_ENABLED_KEY, value ? '1' : '0')
  } catch {
    // ignore storage failures
  }
}

function createTraceId(): string {
  return `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function buildLinuxMetricSnapshotCommand(): string {
  // procps-ng top 空闲字段为「96.5 id」，非「%id」
  return `echo "__MON_METRIC__ cpu=$(c=$(LC_ALL=C top -bn1 2>/dev/null | awk -F',' '/Cpu\\(s\\)|%Cpu/{for(i=1;i<=NF;i++){if($i~/[0-9.]+[ \t]+id/){gsub(/[^0-9.]/,"",$i);if(length($i)){printf "%.2f",100-$i;exit}}}}'); [ -z "$c" ] && c=$(awk '/^cpu /{t=0;for(i=2;i<=NF;i++)t+=$i;printf "%.2f",(t-$5)*100/t}' /proc/stat); printf '%s' "$c") load=$(awk '{print $1}' /proc/loadavg) mem=$(free | awk '/Mem:/{printf "%.2f",$3/$2*100}') disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}') net=$(cat /proc/net/dev | awk -F'[: ]+' 'NR>2{rx+=$3;tx+=$11} END{printf "%d,%d",rx,tx}')"`
}

function compactMonitoringCommand(command: string): string {
  const normalized = command.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 86) return normalized
  return `${normalized.slice(0, 86)}...`
}
