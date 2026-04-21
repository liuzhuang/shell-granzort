import type {
  AppConfig,
  CommandConfig,
  CommandReviewItem,
  DashboardIntentProgressPayload,
  DashboardIntentRequest,
  DashboardIntentResponse,
  DashboardTab,
  ProbePlanStep
} from '../../shared/types'
import { inferRiskLevel } from './security-gate'
import { buildDashboardIntentByDeepAgents } from './deep-agent-intent'

const DASHBOARD_HINT_PATTERNS = [
  /大盘/u,
  /看板/u,
  /dashboard/u,
  /组件/u,
  /widget/u,
  /cpu/u,
  /内存/u,
  /磁盘/u,
  /带宽/u,
  /慢\s*sql/u,
  /事件流/u,
  /图表/u,
  /布局/u,
  /探针/u,
  /审计/u,
  /监控/u
]

const NON_DASHBOARD_PATTERNS = [
  /帮我写.*(shell|bash|python|sql|代码|脚本)/u,
  /写一段.*(shell|bash|python|sql|代码|脚本)/u,
  /翻译/u,
  /润色/u,
  /写邮件/u,
  /周报/u,
  /新闻/u,
  /天气/u,
  /股票/u,
  /面试/u,
  /算法/u
]

function isDashboardRequest(userQuery: string): boolean {
  const text = userQuery.trim().toLowerCase()
  if (!text) return true
  if (DASHBOARD_HINT_PATTERNS.some((pattern) => pattern.test(text))) return true
  if (NON_DASHBOARD_PATTERNS.some((pattern) => pattern.test(text))) return false
  return text.length <= 6
}

function buildCurrentDashboardDraft(request: DashboardIntentRequest): DashboardIntentResponse['draftDashboard'] {
  if (request.context.currentDashboardState) return request.context.currentDashboardState
  const now = Date.now()
  return {
    id: 'ops-main',
    name: '可视化看板',
    contextLabel: request.context.targetDatasourceId || 'prod-master-01',
    createdAt: now,
    updatedAt: now,
    widgets: [],
    gridLayout: []
  }
}

type SelectedShellCommand = Pick<CommandConfig, 'name' | 'command' | 'tags'>

function isRiskLevel(value: unknown): value is 'safe' | 'review' | 'blocked' {
  return value === 'safe' || value === 'review' || value === 'blocked'
}

function isShellType(value: unknown): value is 'bash' | 'zsh' | 'mysql' | 'redis' {
  return value === 'bash' || value === 'zsh' || value === 'mysql' || value === 'redis'
}

function normalizeProbeSteps(dashboard: DashboardTab): DashboardTab {
  return {
    ...dashboard,
    widgets: dashboard.widgets.map((widget) => ({
      ...widget,
      probe: {
        ...widget.probe,
        steps: (widget.probe.steps || []).map((step, index) => {
          const stepId = String(step.stepId || '').trim() || `${widget.id || 'widget'}-step-${index + 1}`
          const command = String(step.command || '').trim() || 'echo "no probe command generated"'
          const inferredRisk = inferRiskLevel(command)
          const isSsh = /^\s*ssh(\s|$)/i.test(command)
          const rawTimeout = Number(step.timeoutMs)
          const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : isSsh ? 45_000 : 5_000
          return {
            ...step,
            stepId,
            command,
            shellType: isShellType(step.shellType) ? step.shellType : 'bash',
            timeoutMs: isSsh ? Math.max(45_000, timeoutMs) : Math.max(5_000, timeoutMs),
            riskLevel: isRiskLevel(step.riskLevel) ? step.riskLevel : inferredRisk
          }
        })
      }
    }))
  }
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase()
}

function pickShellCommandByIntent(request: DashboardIntentRequest, config: AppConfig): SelectedShellCommand | undefined {
  const all = config.commands.map((item) => ({
    name: item.name,
    command: item.command,
    tags: item.tags || []
  }))
  if (all.length === 0) return undefined

  const selectedName = normalizeText(request.context.selectedShellCommandName || '')
  if (selectedName) {
    const found = all.find((item) => normalizeText(item.name) === selectedName)
    if (found) return found
  }

  const query = normalizeText(request.userQuery)
  const byQuery = all.find((item) => {
    if (query.includes(normalizeText(item.name))) return true
    return (item.tags || []).some((tag) => query.includes(normalizeText(tag)))
  })
  if (byQuery) return byQuery

  const fromHistory = (request.history || []).slice().reverse().find((item) => item.role === 'user')
  if (fromHistory?.content) {
    const text = normalizeText(fromHistory.content)
    const byHistory = all.find((item) => text.includes(normalizeText(item.name)) || (item.tags || []).some((tag) => text.includes(normalizeText(tag))))
    if (byHistory) return byHistory
  }

  const preferred = all.find((item) => /\bssh\b/i.test(item.command))
  return preferred || all[0]
}

function escapeForDoubleQuoteShell(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
}

function buildRemoteStepCommand(step: ProbePlanStep): string {
  if (step.shellType === 'mysql') {
    return `mysql -N -e "${escapeForDoubleQuoteShell(step.command)}"`
  }
  if (step.shellType === 'redis') {
    return `redis-cli ${step.command}`
  }
  return step.command
}

function composeStepCommand(baseCommand: string, step: ProbePlanStep): string {
  const trimmed = baseCommand.trim()
  if (!trimmed) return step.command
  if (step.command.includes(trimmed)) return step.command
  if (/^\s*ssh(\s|$)/i.test(trimmed)) {
    const remote = buildRemoteStepCommand(step)
    return `${trimmed} "${escapeForDoubleQuoteShell(remote)}"`
  }
  return `${trimmed} && ${step.command}`
}

function applyConnectionCommand(dashboard: DashboardTab, selectedShell?: SelectedShellCommand): DashboardTab {
  if (!selectedShell?.command) return dashboard
  const datasourceId = selectedShell.name || dashboard.contextLabel
  return {
    ...dashboard,
    contextLabel: datasourceId,
    updatedAt: Date.now(),
    widgets: dashboard.widgets.map((widget) => ({
      ...widget,
      datasourceId,
      probe: {
        ...widget.probe,
        steps: widget.probe.steps.map((step) => ({
          ...step,
          command: composeStepCommand(selectedShell.command, step)
        }))
      }
    }))
  }
}

function assessRenderability(dashboard: DashboardTab): {
  widgetsCount: number
  gridLayoutCount: number
  renderedWidgetCount: number
  layoutMatch: boolean
  isBlankCanvas: boolean
} {
  const widgetIds = new Set(dashboard.widgets.map((item) => item.id))
  const layoutIds = dashboard.gridLayout.map((item) => item.i)
  const renderedWidgetCount = layoutIds.filter((id) => widgetIds.has(id)).length
  const layoutMatch =
    dashboard.widgets.length === renderedWidgetCount &&
    dashboard.gridLayout.length === dashboard.widgets.length &&
    new Set(layoutIds).size === layoutIds.length
  return {
    widgetsCount: dashboard.widgets.length,
    gridLayoutCount: dashboard.gridLayout.length,
    renderedWidgetCount,
    layoutMatch,
    isBlankCanvas: dashboard.widgets.length > 0 && renderedWidgetCount === 0
  }
}

export async function buildDashboardIntent(
  request: DashboardIntentRequest,
  config: AppConfig,
  onProgress?: (payload: DashboardIntentProgressPayload) => void
): Promise<DashboardIntentResponse> {
  const startedAt = Date.now()
  const creationMode = request.creationMode || 'chat'
  const resolvedUserQuery =
    creationMode === 'auto'
      ? request.userQuery.trim() || '请基于当前连接命令自动生成一个运维看板，包含 CPU、内存、磁盘、慢 SQL 与事件流。'
      : request.userQuery
  const selectedShell = pickShellCommandByIntent(request, config)
  const enrichedRequest: DashboardIntentRequest = {
    ...request,
    userQuery: resolvedUserQuery,
    context: {
      ...request.context,
      selectedShellCommandName: selectedShell?.name || request.context.selectedShellCommandName,
      baseConnectionCommand: selectedShell?.command || request.context.baseConnectionCommand,
      availableShellCommands: config.commands.map((item) => ({
        name: item.name,
        command: item.command,
        tags: item.tags || []
      }))
    }
  }
  console.info('[dashboard][intent] shell context resolved', {
    selectedShellCommandName: selectedShell?.name || '(none)',
    selectedCommandPreview: (selectedShell?.command || '').slice(0, 120),
    uploadedCommands: config.commands.length,
    threadId: request.threadId || '(none)'
  })
  console.info('[dashboard][intent] last generation feedback', {
    threadId: request.threadId || '(none)',
    parse: enrichedRequest.context.lastGenerationFeedback?.parse || null,
    render: enrichedRequest.context.lastGenerationFeedback?.render || null
  })
  if (creationMode !== 'auto' && !isDashboardRequest(resolvedUserQuery)) {
    console.info('[dashboard][intent] requestBlockedAsNonDashboard', {
      actionType: enrichedRequest.actionType,
      queryPreview: enrichedRequest.userQuery.slice(0, 80),
      queryLength: enrichedRequest.userQuery.length,
      threadId: request.threadId || '(none)'
    })
    return {
      success: true,
      draftDashboard: buildCurrentDashboardDraft(enrichedRequest),
      commandsToReview: [],
      threadId: request.threadId,
      assistantReply: '该请求不是看板操作。请描述要创建或修改的看板内容，例如「给我一个 CPU、内存与慢 SQL 的监控看板」。'
    }
  }
  const hasKey = Boolean(config.settings.llm.apiKey && !config.settings.llm.apiKey.includes('xxxxx'))
  const intentEngine = 'deepagents'
  console.info('[dashboard][intent] incoming request', {
    actionType: enrichedRequest.actionType,
    queryPreview: enrichedRequest.userQuery.slice(0, 80),
    queryLength: enrichedRequest.userQuery.length,
    threadId: request.threadId || '(none)',
    hasHistory: Boolean(enrichedRequest.history?.length),
    historyLength: enrichedRequest.history?.length || 0,
    hasApiKey: hasKey,
    model: config.settings.llm.model,
    provider: config.settings.llm.provider || 'openai',
    engine: intentEngine
  })
  if (!hasKey) {
    throw new Error('未配置可用 LLM API Key，无法调用 DeepAgents 生成看板。')
  }
  const intentResult = await buildDashboardIntentByDeepAgents(enrichedRequest, config, onProgress)
  console.info('[dashboard][intent] engine done', {
    threadId: intentResult.threadId || request.threadId || '(none)',
    engine: 'deepagents',
    assistantPreview: (intentResult.assistantReply || '').slice(0, 200),
    model: intentResult.stats?.model || config.settings.llm.model,
    provider: intentResult.stats?.provider || (config.settings.llm.provider || 'openai'),
    parsedBy: intentResult.diagnostics?.parsedBy,
    repairAttempted: intentResult.diagnostics?.repairAttempted,
    semanticErrorCount: intentResult.diagnostics?.semanticErrorCount
  })
  const draftDashboard = normalizeProbeSteps(applyConnectionCommand(intentResult.dashboard, selectedShell))
  const renderability = assessRenderability(draftDashboard)
  const { assistantReply, stats, threadId } = intentResult
  const commandsToReview: CommandReviewItem[] = []

  draftDashboard.widgets.forEach((widget) => {
    widget.probe.steps.forEach((step) => {
      const inferred = inferRiskLevel(step.command)
      if (step.riskLevel !== 'blocked' && inferred === 'blocked') {
        step.riskLevel = 'blocked'
      } else if (step.riskLevel === 'safe' && inferred === 'review') {
        step.riskLevel = 'review'
      }
      if (step.riskLevel === 'review' || step.riskLevel === 'blocked') {
        commandsToReview.push({
          widgetTitle: widget.title,
          widgetId: widget.id,
          stepId: step.stepId,
          commandToExecute: step.command,
          riskLevel: step.riskLevel,
          riskReason: step.riskLevel === 'blocked' ? '命中高危命令策略，默认拦截。' : '该命令可能产生较高负载，请确认后执行。'
        })
      }
    })
  })

  console.info('[dashboard][intent] response ready', {
    threadId: threadId || request.threadId || '(none)',
    widgets: draftDashboard.widgets.length,
    widgetIds: draftDashboard.widgets.map((item) => item.id),
    totalSteps: draftDashboard.widgets.reduce((sum, item) => sum + item.probe.steps.length, 0),
    renderability,
    commandsToReview: commandsToReview.length,
    durationMs: stats?.durationMs,
    totalElapsedMs: Date.now() - startedAt
  })

  return {
    success: true,
    draftDashboard,
    commandsToReview,
    threadId,
    assistantReply:
      selectedShell?.name && assistantReply
        ? `${assistantReply}\n\n已使用连接命令：${selectedShell.name}`
        : assistantReply,
    stats,
    intentDiagnostics: {
      engine: 'deepagents',
      parsedBy: intentResult.diagnostics?.parsedBy,
      repairAttempted: intentResult.diagnostics?.repairAttempted || false,
      semanticErrorCount: intentResult.diagnostics?.semanticErrorCount || 0,
      semanticErrors: intentResult.diagnostics?.semanticErrors || [],
      localFixCount: intentResult.diagnostics?.localFixCount || 0,
      localFixes: intentResult.diagnostics?.localFixes || []
    }
  }
}

