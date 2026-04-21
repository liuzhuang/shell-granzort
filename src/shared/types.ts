export type CommandMode = 'service' | 'terminal'
export type ThemePreset = 'system' | 'coder' | 'girl'

export interface CommandHealthCheckConfig {
  type: 'port' | 'log'
  host?: string
  port?: number
  pattern?: string
  intervalSec?: number
  startupGraceSec?: number
  failureThreshold?: number
}

export interface CommandConfig {
  name: string
  command: string
  tags: string[]
  mode?: CommandMode
  webUrl?: string
  autoRestart?: boolean
  maxRestarts?: number
  healthCheck?: CommandHealthCheckConfig
}

export interface PresetSequenceItem {
  command: string
  delay?: number
}

export interface PresetConfig {
  name: string
  sequence: PresetSequenceItem[]
}

export interface AppConfig {
  commands: CommandConfig[]
  presets: PresetConfig[]
  dashboard?: DashboardConfig
  settings: {
    llm: {
      provider?: 'openai' | 'deepseek'
      endpoint: string
      apiKey: string
      model: string
    }
    langsmith?: {
      tracingV2?: boolean
      endpoint?: string
      apiKey?: string
      project?: string
    }
    themePreset?: ThemePreset
    logBufferLines: number
  }
}

export type DashboardRiskLevel = 'safe' | 'review' | 'blocked'
export type DashboardWidgetKind = 'metric' | 'table' | 'timeseries' | 'event'
export type DashboardProbeMode = 'single' | 'multi-step'
export type DashboardActionType = 'CREATE' | 'UPDATE'
export type DashboardCreationMode = 'auto' | 'chat'

export interface ProbePlanStep {
  stepId: string
  command: string
  shellType: 'bash' | 'zsh' | 'mysql' | 'redis'
  timeoutMs: number
  riskLevel: DashboardRiskLevel
  dependsOn?: string[]
}

export interface ProbePlan {
  mode: DashboardProbeMode
  steps: ProbePlanStep[]
}

export interface WidgetSpec {
  id: string
  title: string
  description?: string
  kind: DashboardWidgetKind
  priority: 'high' | 'medium' | 'low'
  datasourceId: string
  probe: ProbePlan
  parserRule: {
    type: 'regex' | 'json' | 'awk-table'
    pattern?: string
    keysMapping?: string[]
  }
}

export interface DashboardGridLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export interface DashboardTab {
  id: string
  name: string
  contextLabel: string
  createdAt: number
  updatedAt: number
  widgets: WidgetSpec[]
  gridLayout: DashboardGridLayoutItem[]
}

export interface DashboardConfig {
  version: number
  activeTabId?: string
  tabs: DashboardTab[]
}

export interface DashboardIntentRequest {
  actionType: DashboardActionType
  creationMode: DashboardCreationMode
  userQuery: string
  threadId?: string
  history?: QueryAiHistoryItem[]
  context: {
    targetDatasourceId: string
    baseConnectionCommand: string
    envInfo: string
    currentDashboardState?: DashboardTab | null
    selectedShellCommandName?: string
    availableShellCommands?: Array<{
      name: string
      command: string
      tags?: string[]
    }>
    lastGenerationFeedback?: DashboardLastGenerationFeedback
  }
}

export interface DashboardLastGenerationFeedback {
  parse?: {
    parsedBy?: string
    repairAttempted?: boolean
    semanticErrorCount?: number
    semanticErrors?: string[]
  }
  render?: {
    widgetsCount: number
    renderedWidgetCount: number
    layoutMatch: boolean
    isBlankCanvas: boolean
  }
}

export interface CommandReviewItem {
  widgetTitle: string
  widgetId: string
  stepId: string
  commandToExecute: string
  riskLevel: DashboardRiskLevel
  riskReason: string
}

export interface DashboardIntentResponse {
  success: boolean
  draftDashboard: DashboardTab
  commandsToReview: CommandReviewItem[]
  threadId?: string
  assistantReply?: string
  stats?: QueryAiStats
  intentDiagnostics?: {
    engine: 'deepagents'
    parsedBy?: string
    repairAttempted: boolean
    semanticErrorCount: number
    semanticErrors?: string[]
    localFixCount?: number
    localFixes?: string[]
  }
}

export interface DashboardIntentProgressPayload {
  threadId: string
  phase:
    | 'start'
    | 'agent_init'
    | 'invoke_start'
    | 'invoke_heartbeat'
    | 'raw_output'
    | 'local_repair'
    | 'llm_repair_start'
    | 'llm_repair_done'
    | 'done'
    | 'error'
  message: string
  at: number
  inputPreview?: string
  outputPreview?: string
  localFixes?: string[]
}

export interface DashboardApproveReviewRequest {
  widgetId: string
  stepId: string
  command: string
}

export interface DashboardApproveReviewResponse {
  ok: boolean
  tokenAuth: string
  expiresAt: number
}

export interface DashboardExecuteProbeRequest {
  widgetId: string
  datasourceId: string
  stepId: string
  command: string
  timeoutMs?: number
  parserRule?: WidgetSpec['parserRule']
  tokenAuth?: string
}

export interface DashboardExecuteProbeResponse {
  success: boolean
  isBlockedBySecurity: boolean
  execResult?: {
    exitCode: number
    stdout: string
    stderr: string
    durationMs: number
  }
  parsedData?: unknown
  riskLevel?: DashboardRiskLevel
  message?: string
}

export interface QueryAiHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface QueryAiRequest {
  requestId: string
  input: string
  history: QueryAiHistoryItem[]
  selectedCommand?: string
  targetLogPath?: string
  sessionLogs: string[]
  queryOutputLines: string[]
}

export interface QueryAiStreamPayload {
  requestId: string
  phase: 'start' | 'chunk' | 'end' | 'error'
  text?: string
  error?: string
  stats?: QueryAiStats
}

export interface QueryAiStats {
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedTokens?: number
  provider: 'openai' | 'deepseek'
  model: string
}

export type ProcessState = 'idle' | 'running' | 'error' | 'restarting'

export interface ProcessStatusPayload {
  commandName: string
  state: ProcessState
  pid?: number
  restarts?: number
  message?: string
  configChanged?: boolean
  exitCode?: number
}

export interface ProcessOutputPayload {
  commandName: string
  line: string
  stream: 'stdout' | 'stderr'
  at: number
}

export interface QueryOutputPayload {
  line: string
  stream: 'stdout' | 'stderr'
  at: number
}

export type PresetAction = 'start' | 'stop'

export interface PresetProgressPayload {
  presetName: string
  action: PresetAction
  index: number
  total: number
  commandName: string
  sequence: string[]
}

export interface TerminalDataPayload {
  commandName: string
  sessionId?: string
  data: string
  at: number
}

export interface TerminalObserverPayload {
  commandName: string
  sessionId?: string
  chunk: string
  at: number
}

export interface TerminalStatusPayload {
  commandName: string
  sessionId?: string
  state: 'running' | 'idle'
  exitCode?: number
}

/** 当前主进程中活跃的交互式 Shell（PTY）会话摘要，用于顶栏实例列表等 */
export interface TerminalInstanceSummary {
  commandName: string
  /** 配置文件中的 command 字段 */
  command: string
  sessionId?: string
  pid?: number
  /** 会话类型：如 terminal-pane（终端页独立 PTY）、monitoring（监控占用的默认槽）、default 等 */
  sessionKind: string
}

export type DetectedProjectType = 'nextjs' | 'vue' | 'react' | 'python' | 'java'

export interface DetectedProject {
  type: DetectedProjectType
  name: string
  rootPath: string
  command: string
  mode: CommandMode
  tags: string[]
  confidence: number
  evidence: string[]
}

export interface DetectProjectsResult {
  canceled: boolean
  rootPath?: string
  projects: DetectedProject[]
}

export interface ProcessInspectorItem {
  pid: number
  name: string
  command: string
  cwd?: string
  parentPid?: number
  parentName?: string
  rootPid?: number
  rootName?: string
  rootCommand?: string
  listeningPorts: number[]
}

export interface PortInspectionResult {
  port: number
  processCount: number
  processes: ProcessInspectorItem[]
}

export interface ProcessKeywordInspectionResult {
  keyword: string
  processCount: number
  processes: ProcessInspectorItem[]
}

/** 主进程通过 `app-update:status` 广播给渲染进程 */
export type AppUpdateBroadcastPayload =
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseDate?: string }
  | { phase: 'not-available'; fromManual?: boolean }
  | {
      phase: 'downloading'
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }
