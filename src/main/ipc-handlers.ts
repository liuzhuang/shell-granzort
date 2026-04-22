import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { exec, spawn as cpSpawn } from 'node:child_process'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import type {
  AppConfig,
  CommandConfig,
  DashboardApproveReviewRequest,
  DashboardExecuteProbeRequest,
  DetectProjectsResult,
  DashboardIntentRequest,
  ProcessInspectorItem,
  PresetAction,
  QueryAiRequest,
  QueryAiStreamPayload,
  QueryOutputPayload,
  TerminalDataPayload,
  TerminalObserverPayload,
  TerminalStatusPayload
} from '../shared/types'
import { ConfigLoader } from './config-loader'
import { ProcessManager } from './process-manager'
import { LlmService } from './llm-service'
import { terminateProcessTreeWithEscalation } from './process-tree'
import { resolveShellExecutable, resolveTerminalArgs } from './shell-runtime'
import { buildDashboardIntent } from './dashboard/intent-service'
import { parseProbeOutput } from './dashboard/parser-core'
import { runProbeCommand } from './dashboard/probe-runner'
import { ReviewTokenStore } from './dashboard/review-token-store'
import { inferRiskLevel, isCommandBlocked } from './dashboard/security-gate'
import { detectProjectsFromRoot } from './project-detector'

export interface IpcRuntimeControl {
  shutdown: () => Promise<void>
}

export function registerIpcHandlers(
  configLoader: ConfigLoader,
  processManager: ProcessManager,
  llmService: LlmService,
  getConfig: () => AppConfig,
  setConfig: (config: AppConfig) => void
): IpcRuntimeControl {
  const terminalMap = new Map<
    string,
    { pty: IPty; commandName: string; sessionId?: string; commandLine: string; sessionKind: string }
  >()
  const terminalBufferMap = new Map<string, string>()
  const terminalLastExitAtMap = new Map<string, number>()
  const terminalObserverPendingMap = new Map<string, string>()
  const terminalObserverTimerMap = new Map<string, ReturnType<typeof setTimeout>>()
  const monitoringTraceBySessionKey = new Map<string, string>()
  const MAX_TERMINAL_BUFFER = 200_000
  const TERMINAL_BUFFER_RETAIN_MS = 30 * 60 * 1000
  const MAX_RETAINED_TERMINAL_BUFFERS = 60
  const MAX_TERMINAL_OBSERVER_CHUNK = 8_000
  const TERMINAL_OBSERVER_DEBOUNCE_MS = 900
  const reviewTokenStore = new ReviewTokenStore()
  const probeGroupTails = new Map<string, Promise<void>>()

  const pruneTerminalBuffers = () => {
    const now = Date.now()
    for (const [sessionKey, exitedAt] of terminalLastExitAtMap.entries()) {
      if (terminalMap.has(sessionKey)) continue
      if (now - exitedAt <= TERMINAL_BUFFER_RETAIN_MS) continue
      terminalLastExitAtMap.delete(sessionKey)
      terminalBufferMap.delete(sessionKey)
    }
    if (terminalBufferMap.size <= MAX_RETAINED_TERMINAL_BUFFERS) return
    const stale = [...terminalLastExitAtMap.entries()]
      .filter(([sessionKey]) => !terminalMap.has(sessionKey))
      .sort((a, b) => a[1] - b[1])
    while (terminalBufferMap.size > MAX_RETAINED_TERMINAL_BUFFERS && stale.length > 0) {
      const [sessionKey] = stale.shift()!
      terminalLastExitAtMap.delete(sessionKey)
      terminalBufferMap.delete(sessionKey)
    }
  }

  const clearTerminalObserver = (sessionKey: string) => {
    const timer = terminalObserverTimerMap.get(sessionKey)
    if (timer) {
      clearTimeout(timer)
      terminalObserverTimerMap.delete(sessionKey)
    }
    terminalObserverPendingMap.delete(sessionKey)
  }

  const flushTerminalObserver = (sessionKey: string, commandName: string, sessionId?: string) => {
    terminalObserverTimerMap.delete(sessionKey)
    const pending = terminalObserverPendingMap.get(sessionKey) || ''
    terminalObserverPendingMap.delete(sessionKey)
    const normalized = normalizeTerminalObserverChunk(pending)
    if (!normalized) return
    broadcast('terminal:observer', asTerminalObserver(commandName, normalized, sessionId))
  }

  const queueTerminalObserver = (sessionKey: string, commandName: string, sessionId: string | undefined, data: string) => {
    const prev = terminalObserverPendingMap.get(sessionKey) || ''
    terminalObserverPendingMap.set(sessionKey, `${prev}${data}`.slice(-MAX_TERMINAL_OBSERVER_CHUNK))
    if (terminalObserverTimerMap.has(sessionKey)) return
    const timer = setTimeout(() => flushTerminalObserver(sessionKey, commandName, sessionId), TERMINAL_OBSERVER_DEBOUNCE_MS)
    terminalObserverTimerMap.set(sessionKey, timer)
  }

  async function enqueueProbeByGroup<T>(groupKey: string, task: () => Promise<T>): Promise<T> {
    const prev = probeGroupTails.get(groupKey) || Promise.resolve()
    const run = prev.then(task, task)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    probeGroupTails.set(groupKey, tail)
    try {
      return await run
    } finally {
      if (probeGroupTails.get(groupKey) === tail) {
        probeGroupTails.delete(groupKey)
      }
    }
  }

  ipcMain.handle('app:get-version', () => app.getVersion())

  ipcMain.handle('config:read', () => configLoader.readRaw())
  ipcMain.handle('config:validate', (_e, raw: string) => configLoader.validate(raw))
  ipcMain.handle('config:save', (_e, raw: string) => {
    configLoader.save(raw)
    const config = configLoader.readParsed()
    setConfig(config)
    processManager.syncConfig(config.commands)
    broadcast('config:loaded', config)
    return { ok: true }
  })

  ipcMain.handle('process:start', (_e, commandName: string) => {
    const command = getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(`命令不存在: ${commandName}`)
    if ((command.mode || 'service') === 'terminal') {
      throw new Error(`命令 ${commandName} 为交互终端模式，请使用“进入终端”`)
    }
    processManager.start(command)
    return { ok: true }
  })
  ipcMain.handle('process:stop', (_e, commandName: string) => {
    processManager.stop(commandName)
    return { ok: true }
  })
  ipcMain.handle('process:restart', (_e, commandName: string) => {
    const command = getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(`命令不存在: ${commandName}`)
    if ((command.mode || 'service') === 'terminal') {
      throw new Error(`命令 ${commandName} 为交互终端模式，不支持后台重启`)
    }
    processManager.restart(command)
    return { ok: true }
  })

  ipcMain.handle('preset:execute', async (_e, presetName: string) => {
    await runPresetSequence('start', presetName, getConfig, processManager)
    return { ok: true }
  })
  ipcMain.handle('preset:stop', async (_e, presetName: string) => {
    await runPresetSequence('stop', presetName, getConfig, processManager)
    return { ok: true }
  })

  ipcMain.handle(
    'project:detect-from-directory',
    async (
      _e,
      request?: { rootPath?: string; maxDepth?: number; maxDirs?: number }
    ): Promise<DetectProjectsResult> => {
      let rootPath = request?.rootPath?.trim() || ''
      if (!rootPath) {
        const selected = await dialog.showOpenDialog({
          title: '选择需要导入的目录',
          properties: ['openDirectory']
        })
        if (selected.canceled || selected.filePaths.length === 0) {
          return { canceled: true, projects: [] }
        }
        rootPath = selected.filePaths[0]
      }
      const projects = await detectProjectsFromRoot(rootPath, {
        maxDepth: request?.maxDepth,
        maxDirs: request?.maxDirs
      })
      return {
        canceled: false,
        rootPath,
        projects
      }
    }
  )

  ipcMain.handle(
    'terminal:start',
    (_e, commandName: string, options?: { source?: string; traceId?: string; sessionId?: string }) => {
    pruneTerminalBuffers()
    const command = getConfig().commands.find((item) => item.name === commandName)
    if (!command) throw new Error(`命令不存在: ${commandName}`)
    const source = options?.source || 'unknown'
    const traceId = options?.traceId || 'trace-missing'
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const isMonitoringSource = source === 'monitoring'
    const isSshCommand = /^\s*ssh(\s|$)/i.test(command.command)
    if (isMonitoringSource && isSshCommand) {
      console.info('[monitoring][ssh] before_connect', {
        traceId,
        commandName,
        sessionId,
        commandPreview: command.command.slice(0, 240),
        at: Date.now()
      })
    }
    const existing = terminalMap.get(sessionKey)
    if (existing) {
      if (isMonitoringSource) {
        monitoringTraceBySessionKey.set(sessionKey, traceId)
      }
      if (isMonitoringSource && isSshCommand) {
        console.info('[monitoring][ssh] connecting(reuse_existing_session)', {
          traceId,
          commandName,
          sessionId,
          pid: existing.pty.pid,
          at: Date.now()
        })
      }
      return {
        ok: true,
        state: 'running' as const,
        buffer: terminalBufferMap.get(sessionKey) || ''
      }
    }
    if (!terminalBufferMap.has(sessionKey)) {
      terminalBufferMap.set(sessionKey, '')
    }
    terminalLastExitAtMap.delete(sessionKey)
    const shellExec = resolveShellExecutable()
    const shellArgs = resolveTerminalArgs(shellExec, command.command)
    let pty: IPty
    try {
      pty = ptySpawn(shellExec, shellArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd: process.cwd(),
        env: process.env
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const hint =
        /posix_spawnp failed/i.test(message)
          ? ' 常见原因：node-pty 未针对当前 Electron 编译，请在项目根目录执行 npm run rebuild:native（或重新 npm install 以触发 postinstall）。'
          : ''
      throw new Error(`无法启动交互终端（shell: ${shellExec}）：${message}${hint}`)
    }
    terminalMap.set(sessionKey, {
      pty,
      commandName,
      sessionId,
      commandLine: command.command,
      sessionKind: resolveTerminalSessionKind(sessionId, options?.source)
    })
    if (isMonitoringSource) {
      monitoringTraceBySessionKey.set(sessionKey, traceId)
    }
    if (isMonitoringSource && isSshCommand) {
      console.info('[monitoring][ssh] connecting(spawned_session)', {
        traceId,
        commandName,
        sessionId,
        pid: pty.pid,
        shellExec,
        at: Date.now()
      })
    }
    broadcast('terminal:status', asTerminalStatus(commandName, 'running', undefined, sessionId))
    pty.onData((data) => {
      const prev = terminalBufferMap.get(sessionKey) || ''
      const merged = `${prev}${data}`
      terminalBufferMap.set(sessionKey, merged.slice(-MAX_TERMINAL_BUFFER))
      broadcast('terminal:data', asTerminalData(commandName, data, sessionId))
      queueTerminalObserver(sessionKey, commandName, sessionId, data)
      const monitoringTraceId = monitoringTraceBySessionKey.get(sessionKey)
      if (monitoringTraceId) {
        const preview = sanitizeTerminalLogPreview(data)
        if (preview) {
          console.info('[monitoring][ssh] command_result', {
            traceId: monitoringTraceId,
            commandName,
            sessionId,
            outputPreview: preview,
            at: Date.now()
          })
        }
      }
    })
    pty.onExit(({ exitCode }) => {
      const monitoringTraceId = monitoringTraceBySessionKey.get(sessionKey)
      if (monitoringTraceId) {
        console.info('[monitoring][ssh] session_exit', {
          traceId: monitoringTraceId,
          commandName,
          sessionId,
          exitCode,
          at: Date.now()
        })
      }
      terminalMap.delete(sessionKey)
      terminalLastExitAtMap.set(sessionKey, Date.now())
      monitoringTraceBySessionKey.delete(sessionKey)
      clearTerminalObserver(sessionKey)
      pruneTerminalBuffers()
      broadcast('terminal:status', asTerminalStatus(commandName, 'idle', exitCode, sessionId))
    })
    return { ok: true, state: 'running' as const, buffer: '' }
    }
  )
  ipcMain.handle(
    'terminal:input',
    (_e, commandName: string, data: string, options?: { source?: string; traceId?: string; sessionId?: string }) => {
    const source = options?.source || 'unknown'
    const traceId = options?.traceId || 'trace-missing'
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    if (source === 'monitoring') {
      const compact = data.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 240)
      console.info('[monitoring][ssh] execute_command', {
        traceId,
        commandName,
        sessionId,
        inputPreview: compact,
        at: Date.now()
      })
    }
    terminalMap.get(sessionKey)?.pty.write(data)
    return { ok: true }
    }
  )
  ipcMain.handle('terminal:resize', (_e, commandName: string, cols: number, rows: number, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    const session = terminalMap.get(sessionKey)
    if (!session) return { ok: true }
    session.pty.resize(Math.max(20, Math.floor(cols)), Math.max(8, Math.floor(rows)))
    return { ok: true }
  })
  ipcMain.handle('terminal:get-buffer', (_e, commandName: string, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    return { text: terminalBufferMap.get(sessionKey) || '' }
  })
  ipcMain.handle('terminal:get-instance-count', () => {
    return { count: terminalMap.size }
  })
  ipcMain.handle('terminal:list-instances', () => {
    const instances = [...terminalMap.values()].map((s) => ({
      commandName: s.commandName,
      command: s.commandLine,
      sessionId: s.sessionId,
      pid: typeof s.pty.pid === 'number' ? s.pty.pid : undefined,
      sessionKind:
        s.sessionKind ??
        (s.sessionId && s.sessionId.trim().length > 0 ? 'terminal-pane' : 'default')
    }))
    return { instances }
  })

  const killTerminalSessionBySessionKey = (sessionKey: string): void => {
    const session = terminalMap.get(sessionKey)
    if (!session) return
    const pty = session.pty
    const pid = pty.pid
    let exited = false
    const disposable = pty.onExit(() => {
      exited = true
    })
    try {
      pty.kill('SIGTERM')
    } catch {
      // handled by tree termination fallback
    }
    void terminateProcessTreeWithEscalation(pid, () => exited || terminalMap.get(sessionKey)?.pty !== pty, 900).finally(() =>
      disposable.dispose()
    )
  }

  ipcMain.handle('terminal:stop', (_e, commandName: string, options?: { sessionId?: string }) => {
    const sessionId = options?.sessionId?.trim() || undefined
    const sessionKey = resolveTerminalSessionKey(commandName, sessionId)
    killTerminalSessionBySessionKey(sessionKey)
    return { ok: true }
  })

  /** 停止该配置命令名下所有 PTY（默认槽 + 各 Pane session），供首页「停止运行」等使用 */
  ipcMain.handle('terminal:stop-all-for-command', (_e, commandName: string) => {
    const target = commandName.trim()
    if (!target) return { ok: true, stopped: 0 }
    const keys = [...terminalMap.entries()].filter(([, s]) => s.commandName === target).map(([k]) => k)
    for (const sessionKey of keys) {
      killTerminalSessionBySessionKey(sessionKey)
    }
    return { ok: true, stopped: keys.length }
  })

  ipcMain.handle('system:open-external', async (_e, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })
  ipcMain.handle('system:kill-port-process', async (_e, port: number) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`端口号不合法: ${String(port)}`)
    }
    const listenerPids = await findListeningPidsByPort(port)
    const pids = await normalizeTerminationRoots(listenerPids)
    for (const pid of pids) {
      await terminateProcessTreeWithEscalation(pid, () => !isPidAlive(pid), 900)
    }
    return { ok: true, port, pids, listenerPids }
  })
  ipcMain.handle('system:kill-port-process-by-keyword', async (_e, keyword: string) => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) throw new Error('关键字不能为空')
    const processPids = await findProcessPidsByKeyword(normalizedKeyword)
    if (processPids.length === 0) {
      throw new Error(`未通过关键字 "${normalizedKeyword}" 识别到进程`)
    }
    const candidateRoots = await normalizeTerminationRoots(processPids)
    const rootSet = new Set<number>(candidateRoots)
    const allListeningPids = await findAllListeningPids()
    const listenerPidSet = new Set<number>()
    for (const pid of allListeningPids) {
      const rootPid = await resolveTerminationRootPid(pid)
      if (rootSet.has(rootPid)) listenerPidSet.add(pid)
    }
    if (listenerPidSet.size === 0) {
      throw new Error(`关键字 "${normalizedKeyword}" 命中的进程未发现 LISTEN 端口，已阻止清理以避免误杀`)
    }
    const ports = await findListeningPortsByPids([...listenerPidSet])
    const targetPids = await normalizeTerminationRoots([...listenerPidSet])
    for (const pid of targetPids) {
      await terminateProcessTreeWithEscalation(pid, () => !isPidAlive(pid), 900)
    }
    return { ok: true, keyword: normalizedKeyword, processPids, ports, killedPids: targetPids, listenerPids: [...listenerPidSet] }
  })
  ipcMain.handle('system:kill-process-by-pid', async (_e, pid: number) => {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`PID 不合法: ${String(pid)}`)
    }
    const rootPid = await resolveTerminationRootPid(pid)
    await terminateProcessTreeWithEscalation(rootPid, () => !isPidAlive(rootPid), 900)
    return {
      ok: true,
      requestedPid: pid,
      rootPid,
      killedPids: [rootPid]
    }
  })
  ipcMain.handle('system:inspect-port-process', async (_e, port: number) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`端口号不合法: ${String(port)}`)
    }
    const pids = await findListeningPidsByPort(port)
    const processes = await loadProcessInspectorItems(pids)
    return {
      port,
      processCount: processes.length,
      processes
    }
  })
  ipcMain.handle('system:inspect-process-by-keyword', async (_e, keyword: string) => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) throw new Error('关键字不能为空')
    const pids = await findProcessPidsByKeyword(normalizedKeyword)
    const processes = await loadProcessInspectorItems(pids)
    return {
      keyword: normalizedKeyword,
      processCount: processes.length,
      processes
    }
  })

  ipcMain.handle('dashboard:intent', async (_e, request: DashboardIntentRequest) => {
    return buildDashboardIntent(request, getConfig(), (payload) => {
      broadcast('dashboard:intent-progress', payload)
    })
  })

  ipcMain.handle('dashboard:approve-review', (_e, payload: DashboardApproveReviewRequest) => {
    const issued = reviewTokenStore.issue(payload.widgetId, payload.stepId, payload.command)
    return {
      ok: true,
      tokenAuth: issued.tokenAuth,
      expiresAt: issued.expiresAt
    }
  })

  ipcMain.handle('dashboard:execute-probe', async (_e, request: DashboardExecuteProbeRequest) => {
    const riskLevel = inferRiskLevel(request.command)
    if (riskLevel === 'blocked' || isCommandBlocked(request.command)) {
      return {
        success: false,
        isBlockedBySecurity: true,
        riskLevel,
        message: '命中高危策略，命令已被拦截。'
      }
    }
    if (riskLevel === 'review') {
      const token = request.tokenAuth || ''
      const approved = reviewTokenStore.validate(token, request.widgetId, request.stepId, request.command)
      if (!approved) {
        return {
          success: false,
          isBlockedBySecurity: false,
          riskLevel,
          message: '该命令需要先授权后执行。'
        }
      }
    }
    const executeTask = () =>
      runProbeCommand(request.command, request.timeoutMs ?? 5000, {
        sessionGroupKey: request.datasourceId || request.widgetId
      })
    const isSshCommand = /^\s*ssh(\s|$)/i.test(request.command)
    const result = isSshCommand ? await enqueueProbeByGroup(request.datasourceId || request.widgetId, executeTask) : await executeTask()
    if (result.exitCode !== 0) {
      console.warn('[dashboard][probe] non-zero exit', {
        widgetId: request.widgetId,
        datasourceId: request.datasourceId,
        stepId: request.stepId,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stderrPreview: result.stderr.slice(0, 240)
      })
    }
    return {
      success: true,
      isBlockedBySecurity: false,
      riskLevel,
      execResult: result,
      parsedData: parseProbeOutput(request.parserRule, result.stdout)
    }
  })

  let runningQuery: ReturnType<typeof cpSpawn> | undefined
  const queryOutputLines: string[] = []
  const MAX_QUERY_OUTPUT_LINES = 2000
  ipcMain.handle('query:execute', (_e, command: string) => {
    runningQuery?.kill('SIGTERM')
    const child = cpSpawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    runningQuery = child
    child.stdout?.on('data', (buf) => {
      const text = String(buf)
      appendQueryOutputLines(queryOutputLines, text, MAX_QUERY_OUTPUT_LINES)
      broadcast('query:output', asQueryOutput(text, 'stdout'))
    })
    child.stderr?.on('data', (buf) => {
      const text = String(buf)
      appendQueryOutputLines(queryOutputLines, text, MAX_QUERY_OUTPUT_LINES)
      broadcast('query:output', asQueryOutput(text, 'stderr'))
    })
    child.on('exit', (code) => {
      const tail = `命令结束，退出码 ${code ?? -1}`
      appendQueryOutputLines(queryOutputLines, tail, MAX_QUERY_OUTPUT_LINES)
      broadcast('query:output', asQueryOutput(tail, 'stdout'))
      runningQuery = undefined
    })
    return { ok: true }
  })
  ipcMain.handle('query:cancel', () => {
    runningQuery?.kill('SIGTERM')
    runningQuery = undefined
    return { ok: true }
  })
  ipcMain.handle('query:ai-chat', async (_e, request: QueryAiRequest) => {
    const enrichedRequest: QueryAiRequest = {
      ...request,
      queryOutputLines: request.queryOutputLines.length > 0 ? request.queryOutputLines : queryOutputLines.slice(-80)
    }
    broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'start'))
    try {
      const result = await llmService.chatToShell(enrichedRequest, getConfig(), async (token) => {
        broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'chunk', token))
      })
      broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'end', result.answer, undefined, result.stats))
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcast('query:ai-stream', asQueryAiStream(request.requestId, 'error', undefined, message))
      throw error
    }
  })

  const shutdown = async () => {
    runningQuery?.kill('SIGTERM')
    runningQuery = undefined
    const terminalEntries = [...terminalMap.entries()]
    if (terminalEntries.length === 0) return
    await Promise.allSettled(
      terminalEntries.map(async ([sessionKey, session]) => {
        const pty = session.pty
        const pid = pty.pid
        try {
          pty.kill('SIGTERM')
        } catch {
          // fallback to tree termination below
        }
        await terminateProcessTreeWithEscalation(pid, () => terminalMap.get(sessionKey)?.pty !== pty, 900)
      })
    )
  }

  return { shutdown }
}

export function broadcast(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asQueryOutput(line: string, stream: 'stdout' | 'stderr'): QueryOutputPayload {
  return {
    line: line.replace(/\n$/, ''),
    stream,
    at: Date.now()
  }
}

function asTerminalData(commandName: string, data: string, sessionId?: string): TerminalDataPayload {
  return { commandName, sessionId, data, at: Date.now() }
}

function asTerminalObserver(commandName: string, chunk: string, sessionId?: string): TerminalObserverPayload {
  return { commandName, sessionId, chunk, at: Date.now() }
}

function asTerminalStatus(
  commandName: string,
  state: 'running' | 'idle',
  exitCode?: number,
  sessionId?: string
): TerminalStatusPayload {
  return { commandName, sessionId, state, exitCode }
}

function resolveTerminalSessionKey(commandName: string, sessionId?: string): string {
  if (sessionId && sessionId.trim().length > 0) return `session:${sessionId.trim()}`
  return `command:${commandName}`
}

/** 区分「终端页独立 PTY」与「每命令仅一条的默认 PTY 槽」（监控/AI 日志等共用） */
function resolveTerminalSessionKind(sessionId: string | undefined, optSource: string | undefined): string {
  if (sessionId && sessionId.trim().length > 0) return 'terminal-pane'
  const src = optSource?.trim()
  if (src === 'monitoring') return 'monitoring'
  if (src && src !== 'unknown') return src
  return 'default'
}

function asQueryAiStream(
  requestId: string,
  phase: QueryAiStreamPayload['phase'],
  text?: string,
  error?: string,
  stats?: QueryAiStreamPayload['stats']
): QueryAiStreamPayload {
  return { requestId, phase, text, error, stats }
}

function appendQueryOutputLines(buffer: string[], text: string, maxLines: number): void {
  const lines = text
    .split(/\r?\n/)
    .map((item) =>
      item
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r/g, '')
        .trimEnd()
    )
    .filter((item) => item.length > 0)
  if (lines.length === 0) return
  buffer.push(...lines)
  if (buffer.length > maxLines) buffer.splice(0, buffer.length - maxLines)
}

function normalizeTerminalObserverChunk(text: string): string {
  const normalized = text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-120)
    .join('\n')
  return normalized.slice(-4_000)
}

function sanitizeTerminalLogPreview(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' | ')
    .slice(0, 260)
}

export function executeShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

export function pickCommand(config: AppConfig, name: string): CommandConfig | undefined {
  return config.commands.find((item) => item.name === name)
}

interface ProcessBasicInfo {
  pid: number
  ppid: number
  name: string
  command: string
}

async function findListeningPidsByPort(port: number): Promise<number[]> {
  const output = await executeShell(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`)
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const value = Number.parseInt(line.trim(), 10)
    if (Number.isFinite(value) && value > 0) pidSet.add(value)
  }
  return [...pidSet]
}

async function findAllListeningPids(): Promise<number[]> {
  const output = await executeShell('lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null || true')
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const value = Number.parseInt(line.trim(), 10)
    if (Number.isFinite(value) && value > 0) pidSet.add(value)
  }
  return [...pidSet]
}

async function findListeningPortsByPids(pids: number[]): Promise<number[]> {
  const portSet = new Set<number>()
  for (const pid of pids) {
    const ports = await findListeningPortsByPid(pid)
    for (const port of ports) portSet.add(port)
  }
  return [...portSet]
}

async function findProcessPidsByKeyword(keyword: string): Promise<number[]> {
  const escapedKeyword = shellSingleQuote(keyword)
  const output = await executeShell(`ps -aef | rg -i -F -- '${escapedKeyword}' | rg -v 'rg -i -F --' || true`)
  const pidSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const columns = trimmed.split(/\s+/)
    if (columns.length < 2) continue
    const pid = Number.parseInt(columns[1], 10)
    if (Number.isFinite(pid) && pid > 0) pidSet.add(pid)
  }
  return [...pidSet]
}

async function findListeningPortsByPid(pid: number): Promise<number[]> {
  const output = await executeShell(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN 2>/dev/null || true`)
  const portSet = new Set<number>()
  for (const line of output.split(/\r?\n/)) {
    const matched = line.match(/:(\d{1,5})\s+\(LISTEN\)\s*$/)
    if (!matched) continue
    const port = Number.parseInt(matched[1], 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) portSet.add(port)
  }
  return [...portSet]
}

async function loadProcessInspectorItems(pids: number[]): Promise<ProcessInspectorItem[]> {
  const items = await Promise.all(pids.map((pid) => loadProcessInspectorItem(pid)))
  return items.filter((item): item is ProcessInspectorItem => Boolean(item)).sort((a, b) => a.pid - b.pid)
}

async function loadProcessInspectorItem(pid: number): Promise<ProcessInspectorItem | undefined> {
  if (!Number.isFinite(pid) || pid <= 0) return undefined
  const infoCache = new Map<number, ProcessBasicInfo | undefined>()
  const [selfInfo, cwdOutput, ports] = await Promise.all([
    getProcessBasicInfo(pid, infoCache),
    executeShell(`lsof -a -d cwd -p ${pid} 2>/dev/null || true`),
    findListeningPortsByPid(pid)
  ])
  if (!selfInfo?.command) return undefined
  const [parentInfo, rootInfo] = await Promise.all([
    selfInfo.ppid > 0 ? getProcessBasicInfo(selfInfo.ppid, infoCache) : Promise.resolve(undefined),
    resolveTerminationRootInfo(pid, infoCache)
  ])
  const cwd = extractCwdFromLsof(cwdOutput)
  return {
    pid: selfInfo.pid,
    name: selfInfo.name,
    command: selfInfo.command,
    cwd,
    parentPid: parentInfo?.pid,
    parentName: parentInfo?.name,
    rootPid: rootInfo?.pid,
    rootName: rootInfo?.name,
    rootCommand: rootInfo?.command,
    listeningPorts: ports
  }
}

async function normalizeTerminationRoots(pids: number[]): Promise<number[]> {
  const infoCache = new Map<number, ProcessBasicInfo | undefined>()
  const rootSet = new Set<number>()
  for (const pid of pids) {
    const root = await resolveTerminationRootInfo(pid, infoCache)
    if (root?.pid) rootSet.add(root.pid)
  }
  return [...rootSet]
}

async function resolveTerminationRootPid(pid: number): Promise<number> {
  const root = await resolveTerminationRootInfo(pid)
  return root?.pid ?? pid
}

async function resolveTerminationRootInfo(
  pid: number,
  infoCache: Map<number, ProcessBasicInfo | undefined> = new Map()
): Promise<ProcessBasicInfo | undefined> {
  let current = await getProcessBasicInfo(pid, infoCache)
  if (!current) return undefined
  for (let hop = 0; hop < 24; hop += 1) {
    if (!current.ppid || current.ppid <= 1) break
    const parent = await getProcessBasicInfo(current.ppid, infoCache)
    if (!parent) break
    if (!isSameExecutableProcess(current, parent)) break
    current = parent
  }
  return current
}

async function getProcessBasicInfo(
  pid: number,
  infoCache: Map<number, ProcessBasicInfo | undefined> = new Map()
): Promise<ProcessBasicInfo | undefined> {
  if (!Number.isFinite(pid) || pid <= 0) return undefined
  if (infoCache.has(pid)) return infoCache.get(pid)
  const output = await executeShell(`ps -p ${pid} -o ppid=,comm=,command= 2>/dev/null || true`)
  const line = output.trim()
  if (!line) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const matched = line.match(/^\s*(\d+)\s+(\S+)\s+([\s\S]+)$/)
  if (!matched) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const ppid = Number.parseInt(matched[1], 10)
  const name = matched[2]?.trim() || 'unknown'
  const command = matched[3]?.trim() || ''
  if (!command) {
    infoCache.set(pid, undefined)
    return undefined
  }
  const info: ProcessBasicInfo = {
    pid,
    ppid: Number.isFinite(ppid) && ppid > 0 ? ppid : 0,
    name,
    command
  }
  infoCache.set(pid, info)
  return info
}

function extractCwdFromLsof(output: string): string | undefined {
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('COMMAND')) continue
    const columns = trimmed.split(/\s+/)
    if (columns.length < 9) continue
    const path = columns.slice(8).join(' ')
    if (path) return path
  }
  return undefined
}

function isSameExecutableProcess(current: ProcessBasicInfo, parent: ProcessBasicInfo): boolean {
  const currentExecutable = extractExecutableName(current.command, current.name)
  const parentExecutable = extractExecutableName(parent.command, parent.name)
  return Boolean(currentExecutable && parentExecutable && currentExecutable === parentExecutable)
}

function extractExecutableName(command: string, fallbackName: string): string {
  const firstToken = command.trim().split(/\s+/)[0] || ''
  const byToken = firstToken.split('/').pop() || ''
  const normalized = (byToken || fallbackName || '').trim().toLowerCase()
  return normalized
}

function shellSingleQuote(input: string): string {
  return input.replace(/'/g, `'\"'\"'`)
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function runPresetSequence(
  action: PresetAction,
  presetName: string,
  getConfig: () => AppConfig,
  processManager: ProcessManager
): Promise<void> {
  const preset = getConfig().presets.find((item) => item.name === presetName)
  if (!preset) throw new Error(`预设不存在: ${presetName}`)
  const sequence = action === 'stop' ? [...preset.sequence].reverse() : preset.sequence
  const sequenceNames = sequence.map((item) => item.command)
  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index]
    if (action === 'start') {
      const command = getConfig().commands.find((item) => item.name === step.command)
      if (command) {
        if ((command.mode || 'service') === 'terminal') {
          broadcast('process:status', {
            commandName: command.name,
            state: 'idle',
            message: '该命令为交互终端模式，已跳过预设自动启动'
          })
        } else {
          processManager.start(command)
        }
      }
    } else {
      const command = getConfig().commands.find((item) => item.name === step.command)
      if (!command || (command.mode || 'service') === 'terminal') continue
      processManager.stop(step.command)
    }
    broadcast('preset:progress', {
      presetName,
      action,
      index,
      total: sequence.length,
      commandName: step.command,
      sequence: sequenceNames
    })
    if (step.delay) await sleep(step.delay * 1000)
  }
}

