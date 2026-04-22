import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import yaml from 'js-yaml'
import { useConfigState } from './hooks/useConfig'
import { useNavigation, type AppPage } from './hooks/useNavigation'
import { useProcessState } from './hooks/useProcess'
import { useQueryState } from './hooks/useQuery'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { QueryPage } from './pages/QueryPageShell'
import { EditorPage } from './pages/EditorPage'
import { LogPage } from './pages/LogPage'
import { TerminalPage } from './pages/TerminalPage'
import { DashboardPage } from './pages/DashboardPage'
import { MonitoringPage } from './pages/MonitoringPage'
import { Toast } from './components/Toast'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { PresetProgressOverlay } from './components/PresetProgressOverlay'
import { ImportProjectsModal, projectKey } from './components/ImportProjectsModal'
import { resolveCommandWebUrl } from './lib/web-url'
import type {
  AppConfig,
  AppUpdateBroadcastPayload,
  CommandConfig,
  DetectedProject,
  ProcessStatusPayload,
  PresetProgressPayload
} from '../shared/types'
import type { ThemeName, ThemePresetId } from './styles/tokens'
import {
  applyTheme,
  applyThemePreset,
  persistTheme,
  persistThemePreset,
  resolveInitialTheme,
  resolveInitialThemePreset
} from './styles/theme'

type ToastTone = 'success' | 'warn' | 'error' | 'info'
type UpdateDisabledReason = 'not-packaged' | 'missing-feed-url' | 'unsupported-platform'
const TICKER_EVENT_LIMIT = 200

const DEMO_COMMAND_NAMES = ['demo-service', 'demo-bad-exit', 'demo-terminal']
const DEMO_PRESET_NAMES = ['演示-后台与异常', '演示-全流程']
const DEMO_HINT_SEEN_KEY = 'home.demoHintSeen'

export default function App() {
  const { page, setPage, selectedCommand, setSelectedCommand } = useNavigation()
  const {
    config,
    editorRaw,
    setEditorRaw,
    editorError,
    setEditorError,
    saveEditor,
    keyword,
    setKeyword,
    activeTag,
    setActiveTag,
    tags,
    filteredCommands
  } = useConfigState()
  const { statusMap, logMap, colorByState } = useProcessState(config.settings.logBufferLines)
  const [terminalStatusMap, setTerminalStatusMap] = useState<Record<string, 'running' | 'idle'>>({})
  const [terminalPreviewByName, setTerminalPreviewByName] = useState<Record<string, string>>({})
  const [terminalInstanceCount, setTerminalInstanceCount] = useState(0)
  const {
    queryInput,
    setQueryInput,
    commandInput,
    setCommandInput,
    chatHistory,
    streamingText,
    isStreaming,
    clearChatHistory,
    favoriteCommands,
    fillCommandFromFavorite,
    addFavoriteCommand,
    removeFavoriteCommand,
    translate
  } =
    useQueryState()
  const [toast, setToast] = useState<{ text: string; tone: ToastTone }>({ text: '', tone: 'info' })
  const [tickerEvents, setTickerEvents] = useState<string[]>([])
  const [updateUi, setUpdateUi] = useState<AppUpdateBroadcastPayload | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [presetProgress, setPresetProgress] = useState<PresetProgressPayload | null>(null)
  const [locateLine, setLocateLine] = useState<number | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commandName: string } | null>(null)
  const [showDemoHint, setShowDemoHint] = useState<boolean>(() => window.localStorage.getItem(DEMO_HINT_SEEN_KEY) !== '1')
  const seenTickerEventRef = useRef<Set<string>>(new Set())
  const [importPreview, setImportPreview] = useState<{
    rootPath: string
    projects: DetectedProject[]
    selectedKeys: Record<string, boolean>
    confirming: boolean
  } | null>(null)
  const selectedCommandConfig = config.commands.find((cmd) => cmd.name === selectedCommand)
  const terminalCommands = useMemo(
    () => config.commands.filter((cmd) => (cmd.mode || 'service') === 'terminal'),
    [config.commands]
  )

  const selectedSessionBufferText = selectedCommand ? terminalPreviewByName[selectedCommand] || '' : ''
  const querySessionBadgeState = useMemo<'running' | 'idle_with_cache' | 'idle_empty'>(() => {
    if (!selectedCommand) return 'idle_empty'
    if (terminalStatusMap[selectedCommand] === 'running') return 'running'
    return selectedSessionBufferText.trim().length > 0 ? 'idle_with_cache' : 'idle_empty'
  }, [selectedCommand, terminalStatusMap, selectedSessionBufferText])
  const [theme, setTheme] = useState<ThemeName>(() => resolveInitialTheme())
  const [themePreset, setThemePreset] = useState<ThemePresetId>(() => resolveInitialThemePreset())
  const runningOverview = useMemo(() => {
    const runningNames = config.commands
      .filter((command) => {
        const mode = command.mode || 'service'
        if (mode === 'terminal') return terminalStatusMap[command.name] === 'running'
        const state = statusMap[command.name]?.state
        return state === 'running' || state === 'restarting'
      })
      .map((command) => command.name)
    return {
      runningCount: runningNames.length,
      totalCount: config.commands.length,
      names: runningNames
    }
  }, [config.commands, statusMap, terminalStatusMap])
  const pushTickerEvent = useCallback((text: string) => {
    const normalized = normalizeTickerText(text)
    if (!normalized) return
    if (seenTickerEventRef.current.has(normalized)) return
    seenTickerEventRef.current.add(normalized)
    setTickerEvents((prev) => [...prev, normalized].slice(-TICKER_EVENT_LIMIT))
  }, [])

  /** 终端页 Pane 带 sessionId，状态广播曾被忽略；按主进程实例列表汇总，避免首页卡片停在「运行中」。 */
  const syncTerminalStatusFromInstances = useCallback(async () => {
    const terminalNames = config.commands.filter((c) => (c.mode || 'service') === 'terminal').map((c) => c.name)
    if (terminalNames.length === 0) return
    try {
      const { instances } = await window.api.terminalListInstances()
      setTerminalStatusMap((prev) => {
        const next = { ...prev }
        for (const name of terminalNames) {
          next[name] = instances.some((i) => i.commandName === name) ? 'running' : 'idle'
        }
        return next
      })
    } catch {
      /* ignore */
    }
  }, [config.commands])

  function notify(text: string, tone: ToastTone = 'info') {
    pushTickerEvent(text)
    setToast({ text, tone })
  }

  useEffect(() => {
    void window.api.getAppVersion().then(setAppVersion).catch(() => setAppVersion(''))
  }, [])

  useEffect(() => {
    return window.api.onAppUpdate((payload) => {
      const tickerText = formatUpdateTickerText(payload)
      if (tickerText) pushTickerEvent(tickerText)
      if (payload.phase === 'not-available' && !payload.fromManual) {
        setUpdateUi(null)
        return
      }
      if (payload.phase === 'not-available' && payload.fromManual) {
        setUpdateUi(payload)
        setToast({ text: '当前已是最新版本', tone: 'success' })
        window.setTimeout(() => setUpdateUi(null), 2200)
        return
      }
      setUpdateUi(payload)
    })
  }, [pushTickerEvent])

  async function handleCheckUpdate() {
    const r = await window.api.updateCheck({ manual: true })
    if (!r.ok && 'reason' in r) {
      notify(`自动更新未启用：${formatUpdateDisabledReason(r.reason)}`, 'info')
    } else if (!r.ok && 'error' in r) {
      notify(`检查更新失败：${r.error}`, 'error')
    }
  }

  async function handleDownloadUpdate() {
    const r = await window.api.updateDownload()
    if (!r.ok && 'reason' in r) {
      notify(`当前环境不支持下载更新：${formatUpdateDisabledReason(r.reason)}`, 'info')
    }
    // 失败时主进程会广播 phase: error，顶栏会显示原因，此处不再重复 Toast
  }

  function dismissDemoHint() {
    setShowDemoHint(false)
    window.localStorage.setItem(DEMO_HINT_SEEN_KEY, '1')
  }

  const demoPresetInstalled = useMemo(() => config.commands.some((cmd) => DEMO_COMMAND_NAMES.includes(cmd.name)), [config.commands])

  async function importDemoCommands() {
    const raw = await window.api.configRead()
    const parsed = yaml.load(raw) as AppConfig
    if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
      throw new Error('当前配置结构异常，无法导入演示命令')
    }
    const existingCommands = new Set(parsed.commands.map((cmd) => cmd.name))
    const existingPresets = new Set(parsed.presets.map((preset) => preset.name))
    const demoCommands: CommandConfig[] = [
      {
        name: 'demo-service',
        command: `node -e "console.log('demo-service started'); let i=0; setInterval(()=>console.log('demo-service tick '+(++i)), 1000)"`,
        tags: ['演示'],
        mode: 'service',
        autoRestart: false
      },
      {
        name: 'demo-bad-exit',
        command: `node -e "console.error('demo-bad-exit boom'); process.exit(2)"`,
        tags: ['演示'],
        mode: 'service',
        autoRestart: false
      },
      {
        name: 'demo-terminal',
        command: `node -e "console.log('demo-terminal ready'); let i=0; setInterval(()=>console.log('demo-terminal heartbeat '+(++i)), 3000)"`,
        tags: ['演示'],
        mode: 'terminal'
      }
    ]
    const demoPresets = [
      {
        name: '演示-后台与异常',
        sequence: [
          { command: 'demo-service', delay: 2 },
          { command: 'demo-bad-exit' }
        ]
      },
      {
        name: '演示-全流程',
        sequence: [
          { command: 'demo-service', delay: 2 },
          { command: 'demo-terminal', delay: 2 },
          { command: 'demo-bad-exit' }
        ]
      }
    ]

    parsed.commands = [...demoCommands.filter((cmd) => !existingCommands.has(cmd.name)), ...parsed.commands]
    parsed.presets = [...demoPresets.filter((preset) => !existingPresets.has(preset.name)), ...parsed.presets]
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
    setEditorRaw(nextRaw)
    dismissDemoHint()
    notify('演示命令已导入，可直接在首页启动体验', 'success')
  }

  async function cleanupDemoCommands() {
    const raw = await window.api.configRead()
    const parsed = yaml.load(raw) as AppConfig
    if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
      throw new Error('当前配置结构异常，无法清理演示命令')
    }
    parsed.commands = parsed.commands.filter((cmd) => !DEMO_COMMAND_NAMES.includes(cmd.name))
    parsed.presets = parsed.presets.filter((preset) => !DEMO_PRESET_NAMES.includes(preset.name))
    const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
    await window.api.configSave(nextRaw)
    setEditorRaw(nextRaw)
    notify('演示命令已清理', 'info')
  }

  async function importDirectoryCommands() {
    const e2eRootPath = window.localStorage.getItem('__e2e_import_root_path') || ''
    const detected = await window.api.pickDirectoryAndDetectProjects(
      e2eRootPath ? { rootPath: e2eRootPath } : undefined
    )
    if (detected.canceled) return
    if (detected.projects.length === 0) {
      notify('未识别到可导入项目，请确认目录结构', 'warn')
      return
    }
    const selectedKeys: Record<string, boolean> = {}
    for (const project of detected.projects) {
      selectedKeys[projectKey(project)] = true
    }
    setImportPreview({
      rootPath: detected.rootPath || '',
      projects: detected.projects,
      selectedKeys,
      confirming: false
    })
  }

  async function confirmImportProjects() {
    if (!importPreview) return
    const selectedProjects = importPreview.projects.filter((project) => importPreview.selectedKeys[projectKey(project)] !== false)
    if (selectedProjects.length === 0) {
      notify('请至少勾选一项再导入', 'warn')
      return
    }
    setImportPreview((prev) => (prev ? { ...prev, confirming: true } : prev))
    try {
      const raw = await window.api.configRead()
      const parsed = yaml.load(raw) as AppConfig
      if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
        throw new Error('当前配置结构异常，无法导入目录命令')
      }
      const existingNames = new Set(parsed.commands.map((cmd) => cmd.name))
      const normalizeCommand = (text: string) => text.replace(/\s+/g, ' ').trim()
      const existingCommands = new Set(parsed.commands.map((cmd) => normalizeCommand(cmd.command)))

      const imported: CommandConfig[] = []
      let skipped = 0
      for (const project of selectedProjects) {
        if (existingCommands.has(normalizeCommand(project.command))) {
          skipped += 1
          continue
        }
        const nextName = uniqueCommandName(project.name, existingNames)
        existingNames.add(nextName)
        existingCommands.add(normalizeCommand(project.command))
        imported.push({
          name: nextName,
          command: project.command,
          tags: [],
          mode: project.mode || 'service',
          autoRestart: false
        })
      }
      if (imported.length === 0) {
        notify(`未导入新命令，已跳过 ${skipped} 条重复项`, 'info')
        setImportPreview(null)
        return
      }
      parsed.commands = [...imported, ...parsed.commands]
      const nextRaw = yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true })
      await window.api.configSave(nextRaw)
      setEditorRaw(nextRaw)
      notify(`已导入 ${imported.length} 条命令，跳过 ${skipped} 条重复项`, 'success')
      setImportPreview(null)
    } catch (error) {
      notify(`导入目录失败：${error instanceof Error ? error.message : String(error)}`, 'error')
      setImportPreview((prev) => (prev ? { ...prev, confirming: false } : prev))
    }
  }

  useEffect(() => {
    const w = window as unknown as { __shellE2ENavigate?: (p: AppPage) => void }
    w.__shellE2ENavigate = (p) => setPage(p)
    return () => {
      delete w.__shellE2ENavigate
    }
  }, [setPage])

  useEffect(() => {
    const off = window.api.onTerminalData((payload) => {
      if (payload.sessionId) return
      setTerminalPreviewByName((prev) => {
        const cur = prev[payload.commandName] || ''
        const next = `${cur}${payload.data}`.slice(-200_000)
        return { ...prev, [payload.commandName]: next }
      })
    })
    return () => {
      void off?.()
    }
  }, [])

  useEffect(() => {
    if (page !== 'query' || !selectedCommand) return
    const cmd = config.commands.find((c) => c.name === selectedCommand)
    if ((cmd?.mode || 'service') !== 'terminal') return
    void window.api.terminalGetBuffer(selectedCommand).then(({ text }) => {
      setTerminalPreviewByName((prev) => ({ ...prev, [selectedCommand]: text }))
    })
  }, [page, selectedCommand, config.commands])

  useEffect(() => {
    if (page !== 'query') return
    const names = new Set(terminalCommands.map((c) => c.name))
    if (!selectedCommand) return
    if (!names.has(selectedCommand)) setSelectedCommand('')
  }, [page, terminalCommands, selectedCommand, setSelectedCommand])

  useEffect(() => {
    void window.api
      .terminalGetInstanceCount()
      .then((payload) => setTerminalInstanceCount(payload.count))
      .catch(() => setTerminalInstanceCount(0))
    void syncTerminalStatusFromInstances()
  }, [syncTerminalStatusFromInstances])

  useEffect(() => {
    window.api.onConfigError(({ error }) => {
      notify(`配置文件加载失败：${error}`, 'error')
    })
    window.api.onProcessStatus((payload) => {
      const commandText = config.commands.find((item) => item.name === payload.commandName)?.command
      const tickerText = formatProcessTickerText(payload, commandText)
      if (tickerText) pushTickerEvent(tickerText)
      if (!payload.message) return
      const tone: ToastTone = payload.state === 'error' ? 'error' : payload.state === 'restarting' ? 'warn' : 'info'
      notify(`${payload.commandName}：${payload.message}`, tone)
    })
    window.api.onPresetProgress((payload) => {
      setPresetProgress(payload)
    })
    window.api.onTerminalStatus(() => {
      void window.api
        .terminalGetInstanceCount()
        .then((result) => setTerminalInstanceCount(result.count))
        .catch(() => {})
      void syncTerminalStatusFromInstances()
    })
  }, [config.commands, pushTickerEvent, syncTerminalStatusFromInstances])

  useEffect(() => {
    applyThemePreset(themePreset)
    applyTheme(theme)
    persistTheme(theme)
    persistThemePreset(themePreset)
  }, [theme, themePreset])

  useEffect(() => {
    if (!toast.text) return
    const durationByTone: Record<ToastTone, number> = {
      success: 2400,
      info: 2800,
      warn: 3600,
      error: 4800
    }
    const timer = window.setTimeout(() => {
      setToast((prev) => (prev.text === toast.text ? { text: '', tone: prev.tone } : prev))
    }, durationByTone[toast.tone])
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!presetProgress) return
    if (presetProgress.index + 1 < presetProgress.total) return
    const doneTimer = window.setTimeout(() => {
      setPresetProgress((prev) => {
        if (!prev) return null
        if (prev.presetName !== presetProgress.presetName) return prev
        if (prev.index !== presetProgress.index) return prev
        return null
      })
    }, 1100)
    return () => window.clearTimeout(doneTimer)
  }, [presetProgress])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--bg)',
        overflow: 'hidden'
      }}
    >
      <Sidebar page={page} onChange={setPage} appVersion={appVersion} onCheckUpdate={handleCheckUpdate} tickerEvents={tickerEvents} />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--bg)'
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <TitleBar
            page={page}
            onChange={setPage}
            theme={theme}
            themePreset={themePreset}
            onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            onSelectThemePreset={(preset) => setThemePreset(preset)}
            runningOverview={runningOverview}
            terminalInstanceCount={terminalInstanceCount}
            updateUi={updateUi}
            onCheckUpdate={handleCheckUpdate}
            onDownloadUpdate={handleDownloadUpdate}
            onQuitAndInstall={() => void window.api.updateQuitAndInstall()}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16 }}>
      {page === 'home' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <HomePage
          config={config}
          statusMap={statusMap}
          terminalStatusMap={terminalStatusMap}
          tags={tags}
          activeTag={activeTag}
          keyword={keyword}
          filteredCommands={filteredCommands}
          colorByState={colorByState}
          onTagChange={setActiveTag}
          onKeywordChange={setKeyword}
          onOpenLog={(name) => {
            setSelectedCommand(name)
            setPage('log')
          }}
          onOpenTerminal={(name) => {
            setSelectedCommand(name)
            setPage('terminal')
          }}
          onMarkActiveCommand={(name) => setSelectedCommand(name)}
          onOpenContextMenu={(payload) => {
            setContextMenu(payload)
          }}
          onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          onTogglePreset={async (presetName, action) => {
            if (action === 'stop') await window.api.presetStop(presetName)
            else await window.api.presetExecute(presetName)
          }}
          demoPresetInstalled={demoPresetInstalled}
          onImportDemoCommands={importDemoCommands}
          onCleanupDemoCommands={cleanupDemoCommands}
          onImportDirectoryCommands={importDirectoryCommands}
          showDemoHint={showDemoHint && !demoPresetInstalled}
          onDismissDemoHint={dismissDemoHint}
        />
        </div>
      )}

      {page === 'log' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <LogPage
          selectedCommand={selectedCommand}
          status={statusMap[selectedCommand]}
          lines={(logMap[selectedCommand] || []).slice(-500)}
          webUrl={selectedCommandConfig ? resolveCommandWebUrl(selectedCommandConfig, logMap[selectedCommand] || []) : undefined}
          onBack={() => setPage('home')}
          onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          onActionSuccess={(message) => notify(message, 'success')}
        />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: page === 'query' ? 'flex' : 'none' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <QueryPage
            queryInput={queryInput}
            commandInput={commandInput}
            setCommandInput={setCommandInput}
            chatHistory={chatHistory}
            streamingText={streamingText}
            isStreaming={isStreaming}
            commands={terminalCommands}
            selectedCommand={selectedCommand}
            terminalBadgeState={querySessionBadgeState}
            setQueryInput={setQueryInput}
            clearChatHistory={clearChatHistory}
            favoriteCommands={favoriteCommands}
            fillCommandFromFavorite={fillCommandFromFavorite}
            addFavoriteCommand={addFavoriteCommand}
            removeFavoriteCommand={removeFavoriteCommand}
            translate={() =>
              translate({
                selectedCommand,
                sessionLogs: [],
                attachSessionLogs: false
              })
            }
            selectCommand={setSelectedCommand}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          />
        </div>
      </div>

      {page === 'dashboard' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DashboardPage />
        </div>
      )}

      {page === 'editor' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <EditorPage
          editorRaw={editorRaw}
          editorError={editorError}
          setEditorRaw={setEditorRaw}
          saveEditor={async () => {
            try {
              const result = await saveEditor()
              if (result.ok) notify('配置已保存并重新加载', 'success')
              else {
                setEditorError(result.error || 'YAML 格式错误')
                notify(`保存失败：${result.error || '格式校验不通过'}`, 'error')
              }
              return result
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              setEditorError(message)
              notify(`保存失败：${message}`, 'error')
              return { ok: false, error: message }
            }
          }}
          reloadEditor={async () => {
            try {
              const raw = await window.api.configRead()
              setEditorRaw(raw)
              setEditorError('')
              notify('已重载配置文件', 'info')
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              setEditorError(message)
              notify(`读取配置文件失败：${message}`, 'error')
            }
          }}
          locateLine={locateLine}
          onLocated={() => setLocateLine(undefined)}
        />
        </div>
      )}
      {page === 'terminal' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TerminalPage
            commandName={selectedCommand}
            commands={terminalCommands.map((item) => ({ name: item.name }))}
            onBack={() => setPage('home')}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
          />
        </div>
      )}
      {page === 'monitoring' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <MonitoringPage
            commandName={selectedCommand}
            commands={terminalCommands.map((item) => ({ name: item.name }))}
            onSelectCommand={setSelectedCommand}
            onActionError={(message) => notify(`指令执行失败：${message}`, 'error')}
            onMonitoringEvent={pushTickerEvent}
            theme={theme}
          />
        </div>
      )}
      </div>

      <Toast text={toast.text} tone={toast.tone} />
      {presetProgress && (
        <PresetProgressOverlay
          presetName={presetProgress.presetName}
          action={presetProgress.action}
          index={presetProgress.index}
          total={presetProgress.total}
          commandName={presetProgress.commandName}
          sequence={presetProgress.sequence}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={buildMenuItems({
            commandName: contextMenu.commandName,
            commands: config.commands,
            terminalStatusMap,
            setPage,
            setSelectedCommand,
            notify,
            setLocateLine,
            editorRaw,
            commandLogs: logMap[contextMenu.commandName] || []
          })}
        />
      )}
      {importPreview && (
        <ImportProjectsModal
          rootPath={importPreview.rootPath}
          projects={importPreview.projects}
          selectedKeys={importPreview.selectedKeys}
          confirming={importPreview.confirming}
          onToggle={(key) =>
            setImportPreview((prev) =>
              prev
                ? {
                    ...prev,
                    selectedKeys: {
                      ...prev.selectedKeys,
                      [key]: !(prev.selectedKeys[key] !== false)
                    }
                  }
                : prev
            )
          }
          onClose={() => {
            if (!importPreview.confirming) setImportPreview(null)
          }}
          onConfirm={() => {
            void confirmImportProjects()
          }}
        />
      )}
      </div>
    </div>
  )
}

function uniqueCommandName(baseName: string, existing: Set<string>): string {
  const sanitized = (baseName || 'auto-import').trim()
  if (!existing.has(sanitized)) return sanitized
  let index = 1
  while (existing.has(`${sanitized}-${index}`)) index += 1
  return `${sanitized}-${index}`
}

function formatUpdateDisabledReason(reason: UpdateDisabledReason): string {
  if (reason === 'not-packaged') return '当前为开发模式（未打包）'
  if (reason === 'missing-feed-url') return '未配置更新地址'
  return '当前平台暂不支持自动更新'
}

function normalizeTickerText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function formatUpdateTickerText(payload: AppUpdateBroadcastPayload): string | null {
  if (payload.phase === 'checking') return '系统正在检查更新'
  if (payload.phase === 'available') return `发现新版本 ${payload.version}`
  if (payload.phase === 'downloading') return '正在下载更新'
  if (payload.phase === 'downloaded') return `新版本 ${payload.version} 已下载完成`
  if (payload.phase === 'error') {
    const short = payload.message.slice(0, 48)
    return `更新失败：${short}${payload.message.length > 48 ? '…' : ''}`
  }
  if (payload.phase === 'not-available') {
    return payload.fromManual ? '当前已是最新版本' : '自动检查更新：当前已是最新版本'
  }
  return null
}

function formatProcessTickerText(payload: ProcessStatusPayload, commandText?: string): string | null {
  const commandPreview = formatCommandPreview(commandText)
  if (payload.state === 'running' && !payload.message) {
    return commandPreview ? `执行命令：${commandPreview}` : `${payload.commandName}：已启动`
  }
  if (payload.message) {
    if (commandPreview) return `命令事件：${commandPreview} ｜ ${payload.message}`
    return `${payload.commandName}：${payload.message}`
  }
  if (payload.state === 'restarting') return commandPreview ? `命令重启：${commandPreview}` : `${payload.commandName}：重启中`
  if (payload.state === 'error') return commandPreview ? `命令异常：${commandPreview}` : `${payload.commandName}：异常退出`
  if (payload.state === 'idle') return commandPreview ? `命令结束：${commandPreview}` : `${payload.commandName}：已停止`
  return null
}

function formatCommandPreview(commandText?: string): string {
  if (!commandText) return ''
  const normalized = commandText.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 72)}...`
}

function buildMenuItems(params: {
  commandName: string
  commands: CommandConfig[]
  terminalStatusMap: Record<string, 'running' | 'idle'>
  setPage: (page: AppPage) => void
  setSelectedCommand: (name: string) => void
  notify: (text: string, tone?: ToastTone) => void
  setLocateLine: (line?: number) => void
  editorRaw: string
  commandLogs: string[]
}): ContextMenuItem[] {
  const { commandName, commands, terminalStatusMap, setPage, setSelectedCommand, notify, setLocateLine, editorRaw, commandLogs } = params
  const commandConfig = commands.find((item) => item.name === commandName)
  const terminalRunning = terminalStatusMap[commandName] === 'running'
  const commandContent = commandConfig?.command || commandName
  const webUrl = commandConfig ? resolveCommandWebUrl(commandConfig, commandLogs) : undefined

  const items: ContextMenuItem[] = [
    {
      key: 'run',
      label: commandConfig?.mode === 'terminal' ? (terminalRunning ? '进入终端窗口' : '开启新终端') : '启动任务',
      group: '快捷运行',
      onClick: async () => {
        try {
          setSelectedCommand(commandName)
          if (commandConfig?.mode === 'terminal') {
            if (terminalRunning) {
              setPage('terminal')
              return
            }
            await window.api.terminalStart(commandName)
            return
          }
          await window.api.processStart(commandName)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    ...(commandConfig?.mode === 'terminal'
      ? []
      : [
          {
            key: 'view-log',
            label: '查看运行日志',
            group: '快捷运行',
            onClick: () => {
              setSelectedCommand(commandName)
              setPage('log')
            }
          } satisfies ContextMenuItem
        ]),
    {
      key: 'open-web',
      label: '打开网站',
      group: '快捷运行',
      onClick: async () => {
        if (!webUrl) {
          notify('未检测到该命令的 Web 地址。请在配置中添加 webUrl。', 'warn')
          return
        }
        try {
          await window.api.openExternal(webUrl)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    {
      key: 'stop',
      label: '强制停止',
      group: '快捷运行',
      onClick: async () => {
        try {
          if (commandConfig?.mode === 'terminal') await window.api.terminalStopAllForCommand(commandName)
          else await window.api.processStop(commandName)
        } catch (error) {
          notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      },
      tone: 'warn'
    },
    ...(commandConfig?.mode === 'terminal'
      ? []
      : [
          {
            key: 'restart',
            label: '立即重启',
            group: '快捷运行',
            onClick: async () => {
              try {
                await window.api.processRestart(commandName)
              } catch (error) {
                notify(`指令执行失败：${error instanceof Error ? error.message : String(error)}`, 'error')
              }
            },
            tone: 'warn'
          } satisfies ContextMenuItem
        ]),
    {
      key: 'copy',
      label: '复制原始指令',
      group: '配置管理',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(commandContent)
          notify(`指令已复制：${commandName}`, 'success')
        } catch (error) {
          notify(`复制失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    },
    {
      key: 'locate',
      label: '在配置文件中查看',
      group: '配置管理',
      onClick: () => {
        const line = findCommandLine(editorRaw, commandName)
        setPage('editor')
        if (!line) {
          notify(`配置中找不到该命令：${commandName}`, 'warn')
          return
        }
        setLocateLine(line)
      }
    },
    { key: 'delete-tip', label: '提示：如需删除，请直接编辑 YAML 文件', group: '更多设置', onClick: () => undefined, tone: 'danger' }
  ]
  return items
}

function findCommandLine(raw: string, commandName: string): number | undefined {
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalized = line.replace(/\s+/g, '')
    if (normalized.includes(`-name:${commandName}`) || normalized.includes(`name:${commandName}`)) {
      return index + 1
    }
    if (line.includes(`name: "${commandName}"`) || line.includes(`name: '${commandName}'`)) {
      return index + 1
    }
  }
  return undefined
}
