import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppUpdateBroadcastPayload,
  DashboardApproveReviewRequest,
  DashboardApproveReviewResponse,
  DashboardExecuteProbeRequest,
  DashboardExecuteProbeResponse,
  DashboardIntentRequest,
  DashboardIntentProgressPayload,
  DashboardIntentResponse,
  DetectProjectsResult,
  PresetProgressPayload,
  ProcessKeywordInspectionResult,
  QueryAiRequest,
  QueryAiStats,
  QueryAiStreamPayload,
  PortInspectionResult,
  ProcessOutputPayload,
  ProcessStatusPayload,
  QueryOutputPayload,
  TerminalDataPayload,
  TerminalInstanceSummary,
  TerminalObserverPayload,
  TerminalStatusPayload
} from '../shared/types'

const api = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,

  configRead: () => ipcRenderer.invoke('config:read') as Promise<string>,
  configValidate: (raw: string) => ipcRenderer.invoke('config:validate', raw) as Promise<{ valid: boolean; error?: string }>,
  configSave: (raw: string) => ipcRenderer.invoke('config:save', raw) as Promise<{ ok: boolean }>,
  onConfigLoaded: (handler: (cfg: AppConfig) => void) => ipcRenderer.on('config:loaded', (_e, payload) => handler(payload)),
  onConfigError: (handler: (payload: { error: string }) => void) => ipcRenderer.on('config:error', (_e, payload) => handler(payload)),

  processStart: (name: string) => ipcRenderer.invoke('process:start', name),
  processStop: (name: string) => ipcRenderer.invoke('process:stop', name),
  processRestart: (name: string) => ipcRenderer.invoke('process:restart', name),
  onProcessStatus: (handler: (payload: ProcessStatusPayload) => void) =>
    ipcRenderer.on('process:status', (_e, payload) => handler(payload)),
  onProcessOutput: (handler: (payload: ProcessOutputPayload) => void) =>
    ipcRenderer.on('process:output', (_e, payload) => handler(payload)),

  queryExecute: (command: string) => ipcRenderer.invoke('query:execute', command),
  queryCancel: () => ipcRenderer.invoke('query:cancel'),
  queryAiChat: (payload: QueryAiRequest) => ipcRenderer.invoke('query:ai-chat', payload) as Promise<{ answer: string; stats: QueryAiStats }>,
  onQueryOutput: (handler: (payload: QueryOutputPayload) => void) =>
    ipcRenderer.on('query:output', (_e, payload) => handler(payload)),
  onQueryAiStream: (handler: (payload: QueryAiStreamPayload) => void) => {
    const wrapped = (_e: unknown, payload: QueryAiStreamPayload) => handler(payload)
    ipcRenderer.on('query:ai-stream', wrapped)
    return () => ipcRenderer.removeListener('query:ai-stream', wrapped)
  },

  presetExecute: (presetName: string) => ipcRenderer.invoke('preset:execute', presetName),
  presetStop: (presetName: string) => ipcRenderer.invoke('preset:stop', presetName),
  onPresetProgress: (handler: (payload: PresetProgressPayload) => void) =>
    ipcRenderer.on('preset:progress', (_e, payload) => handler(payload)),

  pickDirectoryAndDetectProjects: (request?: { rootPath?: string; maxDepth?: number; maxDirs?: number }) =>
    ipcRenderer.invoke('project:detect-from-directory', request || {}) as Promise<DetectProjectsResult>,

  terminalStart: (commandName: string, options?: { source?: string; traceId?: string; sessionId?: string }) =>
    ipcRenderer.invoke('terminal:start', commandName, options) as Promise<{ ok: boolean; state?: 'running' | 'idle'; buffer?: string }>,
  terminalInput: (commandName: string, data: string, options?: { source?: string; traceId?: string; sessionId?: string }) =>
    ipcRenderer.invoke('terminal:input', commandName, data, options) as Promise<{ ok: boolean }>,
  terminalResize: (commandName: string, cols: number, rows: number, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:resize', commandName, cols, rows, options) as Promise<{ ok: boolean }>,
  terminalStop: (commandName: string, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:stop', commandName, options) as Promise<{ ok: boolean }>,
  terminalStopAllForCommand: (commandName: string) =>
    ipcRenderer.invoke('terminal:stop-all-for-command', commandName) as Promise<{ ok: boolean; stopped: number }>,
  terminalGetBuffer: (commandName: string, options?: { sessionId?: string }) =>
    ipcRenderer.invoke('terminal:get-buffer', commandName, options) as Promise<{ text: string }>,
  terminalGetInstanceCount: () => ipcRenderer.invoke('terminal:get-instance-count') as Promise<{ count: number }>,
  terminalListInstances: () =>
    ipcRenderer.invoke('terminal:list-instances') as Promise<{ instances: TerminalInstanceSummary[] }>,
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalDataPayload) => handler(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.removeListener('terminal:data', wrapped)
  },
  onTerminalObserver: (handler: (payload: TerminalObserverPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalObserverPayload) => handler(payload)
    ipcRenderer.on('terminal:observer', wrapped)
    return () => ipcRenderer.removeListener('terminal:observer', wrapped)
  },
  onTerminalStatus: (handler: (payload: TerminalStatusPayload) => void) => {
    const wrapped = (_e: unknown, payload: TerminalStatusPayload) => handler(payload)
    ipcRenderer.on('terminal:status', wrapped)
    return () => ipcRenderer.removeListener('terminal:status', wrapped)
  },

  dashboardIntent: (payload: DashboardIntentRequest) =>
    ipcRenderer.invoke('dashboard:intent', payload) as Promise<DashboardIntentResponse>,
  onDashboardIntentProgress: (handler: (payload: DashboardIntentProgressPayload) => void) => {
    const wrapped = (_e: unknown, payload: DashboardIntentProgressPayload) => handler(payload)
    ipcRenderer.on('dashboard:intent-progress', wrapped)
    return () => ipcRenderer.removeListener('dashboard:intent-progress', wrapped)
  },
  dashboardExecuteProbe: (payload: DashboardExecuteProbeRequest) =>
    ipcRenderer.invoke('dashboard:execute-probe', payload) as Promise<DashboardExecuteProbeResponse>,
  dashboardApproveReview: (payload: DashboardApproveReviewRequest) =>
    ipcRenderer.invoke('dashboard:approve-review', payload) as Promise<DashboardApproveReviewResponse>,

  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<{ ok: boolean }>,
  killPortProcess: (port: number) =>
    ipcRenderer.invoke('system:kill-port-process', port) as Promise<{ ok: boolean; port: number; pids: number[] }>,
  killPortProcessByKeyword: (keyword: string) =>
    ipcRenderer.invoke('system:kill-port-process-by-keyword', keyword) as Promise<{
      ok: boolean
      keyword: string
      processPids: number[]
      ports: number[]
      killedPids: number[]
    }>,
  killProcessByPid: (pid: number) =>
    ipcRenderer.invoke('system:kill-process-by-pid', pid) as Promise<{
      ok: boolean
      requestedPid: number
      rootPid: number
      killedPids: number[]
    }>,
  inspectPortProcess: (port: number) => ipcRenderer.invoke('system:inspect-port-process', port) as Promise<PortInspectionResult>,
  inspectProcessByKeyword: (keyword: string) =>
    ipcRenderer.invoke('system:inspect-process-by-keyword', keyword) as Promise<ProcessKeywordInspectionResult>,

  updateCheck: (opts?: { manual?: boolean }) =>
    ipcRenderer.invoke('app-update:check', opts) as Promise<
      | { ok: true }
      | { ok: false; reason: 'not-packaged' | 'missing-feed-url' | 'unsupported-platform' }
      | { ok: false; error: string }
    >,
  updateQuitAndInstall: () =>
    ipcRenderer.invoke('app-update:quit-and-install') as Promise<
      { ok: true } | { ok: false; reason: 'not-packaged' | 'missing-feed-url' | 'unsupported-platform' }
    >,
  updateDownload: () =>
    ipcRenderer.invoke('app-update:download') as Promise<
      | { ok: true }
      | { ok: false; reason: 'not-packaged' | 'missing-feed-url' | 'unsupported-platform' }
      | { ok: false; error: string }
    >,
  onAppUpdate: (handler: (payload: AppUpdateBroadcastPayload) => void) => {
    const wrapped = (_e: unknown, payload: AppUpdateBroadcastPayload) => handler(payload)
    ipcRenderer.on('app-update:status', wrapped)
    return () => {
      ipcRenderer.removeListener('app-update:status', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
