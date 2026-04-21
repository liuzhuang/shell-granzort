import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FSWatcher } from 'chokidar'
import yaml from 'js-yaml'
import type { AppConfig, CommandMode, DashboardConfig, DashboardRiskLevel, DashboardTab, DashboardWidgetKind, ThemePreset } from '../shared/types'

const HOME_DIR = process.env.SHELL_MANAGE_HOME || app.getPath('home')
const CONFIG_DIR = join(HOME_DIR, '.shell-manage')
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')
const DEFAULT_CONFIG_PATH = join(process.cwd(), 'default-config.yaml')

export class ConfigLoader {
  private watcher?: FSWatcher

  ensureConfigFile(): void {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
    if (!existsSync(CONFIG_PATH)) {
      if (existsSync(DEFAULT_CONFIG_PATH)) copyFileSync(DEFAULT_CONFIG_PATH, CONFIG_PATH)
      else
        writeFileSync(
          CONFIG_PATH,
          'commands: []\npresets: []\ndashboard:\n  version: 1\n  activeTabId: ops-main\n  tabs: []\nsettings:\n  llm:\n    provider: "openai"\n    endpoint: ""\n    apiKey: ""\n    model: ""\n  themePreset: coder\n  logBufferLines: 5000\n'
        )
    }
  }

  readRaw(): string {
    this.ensureConfigFile()
    return readFileSync(CONFIG_PATH, 'utf-8')
  }

  validate(raw: string): { valid: boolean; error?: string } {
    try {
      const parsed = yaml.load(raw) as AppConfig
      if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
        return { valid: false, error: '配置结构不完整，缺少 commands/presets/settings' }
      }
      for (const command of parsed.commands) {
        if (command.mode && !isCommandMode(command.mode)) {
          return { valid: false, error: `命令 ${command.name} 的 mode 非法：${command.mode}` }
        }
        if (command.healthCheck) {
          const error = validateHealthCheck(command.name, command.healthCheck)
          if (error) return { valid: false, error }
        }
      }
      const dashboardError = validateDashboardConfig(parsed.dashboard)
      if (dashboardError) return { valid: false, error: dashboardError }
      if (parsed.settings.themePreset && !isThemePreset(parsed.settings.themePreset)) {
        return { valid: false, error: `themePreset 非法：${String(parsed.settings.themePreset)}，仅支持 system/coder/girl` }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  readParsed(): AppConfig {
    const raw = this.readRaw()
    const result = this.validate(raw)
    if (!result.valid) throw new Error(result.error)
    const parsed = yaml.load(raw) as AppConfig
    parsed.commands = parsed.commands.map((command) => ({
      ...command,
      mode: command.mode && isCommandMode(command.mode) ? command.mode : 'service'
    }))
    parsed.dashboard = normalizeDashboardConfig(parsed.dashboard)
    parsed.settings.llm.provider = parsed.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
    parsed.settings.langsmith = normalizeLangsmithConfig(parsed.settings.langsmith)
    parsed.settings.themePreset = normalizeThemePreset(parsed.settings.themePreset)
    return parsed
  }

  save(raw: string): void {
    const result = this.validate(raw)
    if (!result.valid) throw new Error(result.error)
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, raw, 'utf-8')
  }

  getConfigPath(): string {
    return CONFIG_PATH
  }

  watch(onChange: () => void): void {
    this.watcher?.close()
    void import('chokidar').then((mod) => {
      this.watcher = mod.default.watch(CONFIG_PATH, { ignoreInitial: true })
      this.watcher.on('change', () => onChange())
    })
  }
}

function isCommandMode(value: unknown): value is CommandMode {
  return value === 'service' || value === 'terminal'
}

function validateHealthCheck(commandName: string, healthCheck: unknown): string | undefined {
  if (!healthCheck || typeof healthCheck !== 'object') {
    return `命令 ${commandName} 的 healthCheck 必须是对象`
  }
  const config = healthCheck as Record<string, unknown>
  if (config.type !== 'port' && config.type !== 'log') {
    return `命令 ${commandName} 的 healthCheck.type 仅支持 "port" 或 "log"`
  }
  if (config.type === 'port') {
    if (typeof config.port !== 'number' || !Number.isFinite(config.port) || config.port <= 0 || config.port > 65535) {
      return `命令 ${commandName} 的 healthCheck.port 必须是 1-65535 的数字`
    }
  }
  if (config.type === 'log') {
    if (typeof config.pattern !== 'string' || config.pattern.trim().length === 0) {
      return `命令 ${commandName} 的 healthCheck.pattern 不能为空`
    }
  }
  return undefined
}

function normalizeDashboardConfig(config: AppConfig['dashboard']): DashboardConfig {
  if (!config || !Array.isArray(config.tabs)) {
    return {
      version: 1,
      activeTabId: 'ops-main',
      tabs: [createDefaultDashboardTab()]
    }
  }
  if (config.tabs.length === 0) {
    return {
      version: Number.isFinite(config.version) ? Math.max(1, Math.floor(config.version)) : 1,
      activeTabId: 'ops-main',
      tabs: [createDefaultDashboardTab()]
    }
  }
  const tabs = config.tabs.map((tab) => ({
    ...tab,
    contextLabel: tab.contextLabel || 'prod-master-01',
    createdAt: Number.isFinite(tab.createdAt) ? tab.createdAt : Date.now(),
    updatedAt: Number.isFinite(tab.updatedAt) ? tab.updatedAt : Date.now(),
    widgets: Array.isArray(tab.widgets) ? tab.widgets : [],
    gridLayout: Array.isArray(tab.gridLayout) ? tab.gridLayout : []
  }))
  return {
    version: Number.isFinite(config.version) ? Math.max(1, Math.floor(config.version)) : 1,
    activeTabId: config.activeTabId || tabs[0].id,
    tabs
  }
}

function validateDashboardConfig(config: AppConfig['dashboard']): string | undefined {
  if (!config) return undefined
  if (typeof config !== 'object') return 'dashboard 配置必须是对象'
  if (!Array.isArray(config.tabs)) return 'dashboard.tabs 必须是数组'
  for (const tab of config.tabs) {
    if (!tab || typeof tab !== 'object') return 'dashboard.tabs 存在非法项'
    if (!tab.id || typeof tab.id !== 'string') return 'dashboard.tabs[].id 必须是非空字符串'
    if (!tab.name || typeof tab.name !== 'string') return `dashboard tab ${tab.id} 缺少 name`
    if (!Array.isArray(tab.widgets)) return `dashboard tab ${tab.id} 的 widgets 必须是数组`
    if (!Array.isArray(tab.gridLayout)) return `dashboard tab ${tab.id} 的 gridLayout 必须是数组`
    const widgetIds = new Set<string>()
    for (const widget of tab.widgets) {
      if (!widget.id || typeof widget.id !== 'string') return `dashboard tab ${tab.id} 存在无效 widget.id`
      if (widgetIds.has(widget.id)) return `dashboard tab ${tab.id} 中 widget.id 重复：${widget.id}`
      widgetIds.add(widget.id)
      if (!isWidgetKind(widget.kind)) return `dashboard widget ${widget.id} 的 kind 非法：${String(widget.kind)}`
      if (!widget.datasourceId || typeof widget.datasourceId !== 'string') return `dashboard widget ${widget.id} 缺少 datasourceId`
      if (!widget.probe || !Array.isArray(widget.probe.steps)) return `dashboard widget ${widget.id} 缺少 probe.steps`
      for (const step of widget.probe.steps) {
        if (!step.stepId || !step.command) return `dashboard widget ${widget.id} 存在无效 probe step`
        if (!isRiskLevel(step.riskLevel)) return `dashboard widget ${widget.id} 的 riskLevel 非法：${String(step.riskLevel)}`
      }
    }
    for (const grid of tab.gridLayout) {
      if (!widgetIds.has(grid.i)) return `dashboard tab ${tab.id} 的 gridLayout.i 未对应 widget: ${grid.i}`
      if (![grid.x, grid.y, grid.w, grid.h].every((n) => Number.isFinite(n))) return `dashboard tab ${tab.id} 的 gridLayout 坐标非法`
      if (grid.w <= 0 || grid.h <= 0) return `dashboard tab ${tab.id} 的 gridLayout 宽高必须大于 0`
    }
  }
  return undefined
}

function createDefaultDashboardTab(): DashboardTab {
  const now = Date.now()
  return {
    id: 'ops-main',
    name: '可视化看板',
    contextLabel: 'prod-master-01',
    createdAt: now,
    updatedAt: now,
    widgets: [],
    gridLayout: []
  }
}

function isRiskLevel(value: unknown): value is DashboardRiskLevel {
  return value === 'safe' || value === 'review' || value === 'blocked'
}

function isWidgetKind(value: unknown): value is DashboardWidgetKind {
  return value === 'metric' || value === 'table' || value === 'timeseries' || value === 'event'
}

function isThemePreset(value: unknown): value is ThemePreset {
  return value === 'system' || value === 'coder' || value === 'girl'
}

function normalizeThemePreset(value: unknown): ThemePreset {
  return isThemePreset(value) ? value : 'coder'
}

function normalizeLangsmithConfig(config: AppConfig['settings']['langsmith']): AppConfig['settings']['langsmith'] {
  if (!config || typeof config !== 'object') {
    return {
      tracingV2: false,
      endpoint: '',
      apiKey: '',
      project: ''
    }
  }
  return {
    tracingV2: Boolean(config.tracingV2),
    endpoint: typeof config.endpoint === 'string' ? config.endpoint : '',
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    project: typeof config.project === 'string' ? config.project : ''
  }
}
