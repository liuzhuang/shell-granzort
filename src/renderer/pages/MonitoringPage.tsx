import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Panel } from '../components/Panel'
import { buttonStyle, inputStyle } from '../lib/uiStyles'
import type { ThemeName } from '../styles/tokens'
import {
  getMonitoringSystemSkin,
  type MonitoringTuiSkin
} from '../styles/monitoringTuiThemes'

interface MetricSnapshot {
  cpuUsage?: number
  load1m?: number
  memoryUsage?: number
  diskUsage?: number
  netRxKbps?: number
  netTxKbps?: number
}

interface AiInsightEntry {
  id: string
  text: string
  /** 本次分析完成时的本地时间戳 */
  at: number
}

const MONITORING_LAST_COMMAND_KEY = 'monitoring.lastCommand.v1'
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
  commands: Array<{ name: string }>
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
  const [aiInsightItems, setAiInsightItems] = useState<AiInsightEntry[]>([])
  const [aiLoading, setAiLoading] = useState(false)
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
    if (commands.length === 0) return
    const validCurrent = commandName && commands.some((item) => item.name === commandName)
    if (validCurrent) return
    const saved = loadLastCommand()
    if (saved && commands.some((item) => item.name === saved)) {
      onSelectCommand(saved)
      return
    }
    onSelectCommand(commands[0].name)
  }, [commandName, commands, onSelectCommand])

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
    setAiInsightItems([])
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

  function pushAiInsight(text: string): void {
    const trimmed = text.trim()
    const entry: AiInsightEntry = {
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed || '（空结果）',
      at: Date.now()
    }
    setAiInsightItems((prev) => [entry, ...prev].slice(0, 48))
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
        pushAiInsight('当前监控流暂无可分析输出（已拉取缓冲区，无可送模型的内容）。')
        return
      }
      const result = await window.api.queryAiChat({
        requestId: `monitoring-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input:
          '你是 AI 服务器监控助手。请结合下方会话输出，输出最多 3 条简洁结论：是否存在异常或风险、严重度、建议下一步。若需告警式提示，请明确写出「告警」或风险点。',
        history: [],
        selectedCommand: commandName,
        sessionLogs: lines,
        queryOutputLines: []
      })
      pushAiInsight(result.answer.trim() || '未提取到有效洞察。')
    } catch {
      pushAiInsight(buildFallbackInsight(latestChunk))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div data-testid="monitoring-page">
      <Panel style={{ background: skin.shell.bg, borderColor: skin.shell.border, color: skin.shell.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>AI服务器监控 · {commandName || '未选择监控源'}</div>
            <div style={{ fontSize: 12, color: skin.subtitle }}>
              状态：{sessionState === 'running' ? '采集中' : '空闲'}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: skin.meta, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background:
                      monitorStatus === 'ok'
                        ? skin.statusDot.ok
                        : monitorStatus === 'warn'
                          ? skin.statusDot.warn
                          : monitorStatus === 'error'
                            ? skin.statusDot.error
                            : skin.statusDot.idle
                  }}
                />
                采集状态：{monitorStatus === 'ok' ? '正常' : monitorStatus === 'warn' ? '延迟' : monitorStatus === 'error' ? '异常' : '未启动'}
              </span>
              <span>最近采集派发：{lastPollAt ? formatTime(lastPollAt) : '--'}</span>
              <span>最近指标入库：{lastMetricAt ? formatTime(lastMetricAt) : '--'}</span>
              <span>失败计数：{pollErrorCount}</span>
              {metricLagSec !== null ? <span>指标延迟：{metricLagSec}s</span> : null}
            </div>
            {lastPollError ? <div style={{ marginTop: 2, fontSize: 11, color: skin.error }}>最近错误：{lastPollError}</div> : null}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
              justifyContent: 'flex-end'
            }}
          >
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
            <select
              value={commandName}
              onChange={(e) => onSelectCommand(e.target.value)}
              style={toolbarSelectSkin}
            >
              <option value="">请选择命令</option>
              {commands.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)',
            gap: 10,
            alignItems: 'stretch'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {!commandName ? (
                <Panel
                  soft
                  style={{
                    gridColumn: '1 / -1',
                    background: skin.panelInset.bg,
                    borderColor: skin.panelInset.border,
                    color: skin.panelInset.text
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>请先选择监控命令</div>
                  <div style={{ fontSize: 12, color: skin.anomaly.detail }}>
                    当前未选择命令，监控采集不会启动。请选择命令后将自动开始采集；之后会记住你的选择并在下次进入时自动恢复运行。
                  </div>
                </Panel>
              ) : null}
              <TuiMetricCard
                nameZh="CPU 使用率"
                nameEn="CPU Usage"
                hintZh="当前采样下 CPU 非空闲时间占比，近似即时忙闲（非长期平均）。"
                valueText={fmtPct(latestMetrics.cpuUsage)}
                series={cpuSeries}
                skin={skin}
              />
              <TuiMetricCard
                nameZh="系统负载（1 分钟）"
                nameEn="Load (1m)"
                hintZh="过去 1 分钟运行队列长度均值；可大于 CPU 核数，高值表示排队压力大。"
                valueText={fmtLoad(latestMetrics.load1m)}
                series={loadSeries}
                skin={skin}
              />
              <TuiMetricCard
                nameZh="内存占用率"
                nameEn="Memory Usage"
                hintZh="物理内存已用占总量比例（由 free 推算）。"
                valueText={fmtPct(latestMetrics.memoryUsage)}
                series={memorySeries}
                skin={skin}
              />
              <TuiMetricCard
                nameZh="磁盘占用（根分区 /）"
                nameEn="Disk Usage"
                hintZh="根挂载点使用率（df /），非单盘全部卷。"
                valueText={fmtPct(latestMetrics.diskUsage)}
                series={diskSeries}
                skin={skin}
              />
              <TuiMetricCard
                nameZh="入网吞吐"
                nameEn="Network RX"
                hintZh="各网卡接收字节合计，与上次采样算速率；为估算值。"
                valueText={fmtKbps(latestMetrics.netRxKbps)}
                series={netRxSeries}
                skin={skin}
              />
              <TuiMetricCard
                nameZh="出网吞吐"
                nameEn="Network TX"
                hintZh="各网卡发送字节合计，与上次采样算速率；为估算值。"
                valueText={fmtKbps(latestMetrics.netTxKbps)}
                series={netTxSeries}
                skin={skin}
              />
              <div style={{ gridColumn: '1 / -1' }}>
                <Panel
                  soft
                  style={{
                    background: skin.panelRaised.bg,
                    borderColor: skin.panelRaised.border,
                    color: skin.panelRaised.text,
                    minHeight: 120
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
                        top 快照
                        <span style={{ fontWeight: 600, marginLeft: 8, fontSize: 11, color: skin.meta }}>
                          {topCapturedAt ? `已更新 ${formatTime(topCapturedAt)}` : '未抓取'}
                          {topLastKind ? (topLastKind === 'threads' ? ' · 线程视图' : ' · 进程视图') : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: skin.meta, marginTop: 3, opacity: 0.9 }}>
                        Process / threads (batch, top -bn1 / -H)
                      </div>
                      <div style={{ fontSize: 10, color: skin.meta, marginTop: 4, lineHeight: 1.4, opacity: 0.92 }}>
                        「抓取进程」发送 <code style={{ fontSize: 10 }}>top -bn1</code>；「抓取线程」发送{' '}
                        <code style={{ fontSize: 10 }}>top -bn1 -H</code>（按线程）。输出以列表展示；与上方指标轮询独立。
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        style={btnMutedSkin}
                        disabled={!commandName || !monitorEnabled || topLoading}
                        title="批处理 top -bn1，进程级 CPU 排序"
                        onClick={() => void runTopSnapshot('process')}
                      >
                        {topLoading ? '抓取中…' : '抓取进程'}
                      </button>
                      <button
                        type="button"
                        style={btnMutedSkin}
                        disabled={!commandName || !monitorEnabled || topLoading}
                        title="批处理 top -bn1 -H，按线程（LWP）展示"
                        onClick={() => void runTopSnapshot('threads')}
                      >
                        {topLoading ? '抓取中…' : '抓取线程'}
                      </button>
                    </div>
                  </div>
                  {topOutputLines.length === 0 ? (
                    <div style={{ fontSize: 11, color: skin.meta, opacity: 0.88 }}>
                      暂无输出。选择命令后点击「抓取进程」或「抓取线程」。
                    </div>
                  ) : (
                    <ul
                      style={{
                        margin: 0,
                        padding: '6px 0 0',
                        listStyle: 'none',
                        maxHeight: 320,
                        overflow: 'auto',
                        borderTop: `1px solid ${skin.anomaly.border}`
                      }}
                    >
                      {topOutputLines.map((row, idx) => (
                        <li
                          key={`top-${idx}-${row.slice(0, 24)}`}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            lineHeight: 1.35,
                            padding: '3px 0',
                            borderBottom: `1px solid ${skin.panelInset.border}`,
                            color: skin.panelRaised.text,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all'
                          }}
                        >
                          {row}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>

            <Panel soft style={{ marginTop: 10, background: skin.panelInset.bg, borderColor: skin.panelInset.border, color: skin.panelInset.text }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>原始解析值调试面板</div>
                <button style={btnMutedSkin} onClick={() => setDebugOpen((prev) => !prev)}>
                  {debugOpen ? '折叠' : '展开'}
                </button>
              </div>
              {debugOpen ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Panel soft style={{ background: skin.panelDeep.bg, borderColor: skin.panelDeep.border }}>
                    <div style={{ fontSize: 11, color: skin.panelDeep.label, marginBottom: 4 }}>最近解析结果</div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: skin.panelInset.text }}>
                      {JSON.stringify(debugParsed, null, 2)}
                    </pre>
                  </Panel>
                  <Panel soft style={{ background: skin.panelDeep.bg, borderColor: skin.panelDeep.border }}>
                    <div style={{ fontSize: 11, color: skin.panelDeep.label, marginBottom: 4 }}>最近原始采样片段</div>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        maxHeight: 160,
                        overflow: 'auto',
                        color: skin.panelInset.text
                      }}
                    >
                      {latestChunk || '暂无采样片段'}
                    </pre>
                  </Panel>
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel
            soft
            style={{
              background: skin.panelRaised.bg,
              borderColor: skin.panelRaised.border,
              color: skin.panelRaised.text,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 280,
              maxHeight: 'min(92vh, 960px)',
              position: 'sticky',
              top: 0,
              alignSelf: 'start'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8, flexShrink: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>AI 洞察</div>
                <div style={{ fontSize: 10, color: skin.meta, lineHeight: 1.35, marginTop: 4, opacity: 0.88 }}>
                  每次分析均经主进程拉取终端缓冲并调用 AI（非仅界面刷新）；列表逐条展示结果。
                </div>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                    fontSize: 11,
                    color: skin.meta,
                    cursor: 'pointer',
                    userSelect: 'none',
                    opacity: 0.92
                  }}
                >
                  <input
                    type="checkbox"
                    checked={aiAutoRefresh}
                    onChange={(e) => setAiAutoRefresh(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: skin.shell.text, flexShrink: 0 }}
                  />
                  流更新时自动拉取并请求 AI
                </label>
              </div>
              <button
                type="button"
                title="调用 terminal:get-buffer 拉取缓冲，再 query:ai-chat 请求模型"
                style={{
                  ...btnMutedSkin,
                  fontSize: 10,
                  padding: '5px 9px',
                  width: 'fit-content',
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                onClick={() => void refreshAiInsight()}
                disabled={aiLoading || !commandName || !monitorEnabled}
              >
                {aiLoading ? '请求中…' : '拉取并分析'}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {!commandName ? (
                <div style={{ fontSize: 11, color: skin.meta, opacity: 0.85 }}>选择监控命令后可生成分析。</div>
              ) : aiInsightItems.length === 0 ? (
                <div style={{ fontSize: 11, color: skin.meta, opacity: 0.85 }}>
                  暂无记录。
                  {aiAutoRefresh
                    ? ' 流更新时会自动拉缓冲并请求 AI，也可点「拉取并分析」。'
                    : ' 已关闭自动请求，请点「拉取并分析」手动走完整 API。'}
                </div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {aiInsightItems.map((item) => (
                    <li
                      key={item.id}
                      style={{
                        borderBottom: `1px solid ${skin.anomaly.border}`,
                        padding: '10px 0'
                      }}
                    >
                      <div style={{ fontSize: 9, color: skin.meta, opacity: 0.62, marginBottom: 6, letterSpacing: 0.15 }}>
                        搜集 {formatInsightCollectedAt(item.at)}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.45, color: skin.panelRaised.text }}>{item.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </Panel>
    </div>
  )
}

function TuiMetricCard({
  nameZh,
  nameEn,
  hintZh,
  valueText,
  series,
  skin
}: {
  nameZh: string
  nameEn: string
  hintZh: string
  valueText: string
  series: number[]
  skin: MonitoringTuiSkin
}) {
  const lines = buildBlockChart(series)
  return (
    <Panel
      soft
      style={{
        background: skin.panelRaised.bg,
        borderColor: skin.panelRaised.border,
        color: skin.panelRaised.text,
        minHeight: 196
      }}
    >
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
          {nameZh}
          <span style={{ fontWeight: 700, marginLeft: 8 }}>{valueText}</span>
        </div>
        <div style={{ fontSize: 10, color: skin.meta, marginTop: 3, opacity: 0.9 }}>{nameEn}</div>
        <div style={{ fontSize: 10, color: skin.meta, marginTop: 4, lineHeight: 1.4, opacity: 0.92 }}>{hintZh}</div>
      </div>
      <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.15, color: skin.chart }}>{lines}</pre>
    </Panel>
  )
}

function buildBlockChart(values: number[]): string {
  const rows = 8
  const cols = 42
  if (values.length === 0) return Array.from({ length: rows }, () => ' '.repeat(cols)).join('\n')
  const filled = values.slice(-cols)
  const min = Math.min(...filled)
  const max = Math.max(...filled)
  const normalized = filled.map((v) => {
    if (max === min) return Math.round(rows * 0.5)
    return Math.max(1, Math.min(rows, Math.round(((v - min) / (max - min)) * (rows - 1)) + 1))
  })
  const matrix: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '))
  for (let c = 0; c < cols; c += 1) {
    const idx = normalized[Math.max(0, normalized.length - cols + c)] || 0
    for (let r = rows - 1; r >= rows - idx; r -= 1) matrix[r][c] = '█'
  }
  return matrix.map((line) => line.join('')).join('\n')
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
