import type { AppConfig } from '../../shared/types'
import { getProcessStateLabel, type RuntimeStatus } from '../lib/view-models'
import { buttonStyle, chipStyle, inputStyle } from '../lib/uiStyles'
import { Panel } from '../components/Panel'
import { TerminalIcon } from '../components/icons/TerminalIcon'
import { ServiceIcon } from '../components/icons/ServiceIcon'
import { PlayIcon } from '../components/icons/PlayIcon'
import { StopIcon } from '../components/icons/StopIcon'
import { ListIcon } from '../components/icons/ListIcon'
import { XIcon } from '../components/icons/XIcon'
import { useState } from 'react'

export function HomePage(props: {
  config: AppConfig
  statusMap: Record<string, RuntimeStatus>
  terminalStatusMap: Record<string, 'running' | 'idle'>
  tags: string[]
  activeTag: string
  keyword: string
  filteredCommands: AppConfig['commands']
  colorByState: (state: RuntimeStatus['state']) => string
  onTagChange: (tag: string) => void
  onKeywordChange: (text: string) => void
  onOpenLog: (commandName: string) => void
  onOpenTerminal: (commandName: string) => void
  onOpenContextMenu: (payload: { x: number; y: number; commandName: string }) => void
  onActionError: (message: string) => void
  onTogglePreset: (presetName: string, action: 'start' | 'stop') => Promise<void>
  demoPresetInstalled: boolean
  onImportDemoCommands: () => Promise<void>
  onCleanupDemoCommands: () => Promise<void>
  onImportDirectoryCommands: () => Promise<void>
  showDemoHint: boolean
  onDismissDemoHint: () => void
}) {
  const {
    config,
    statusMap,
    terminalStatusMap,
    tags,
    activeTag,
    keyword,
    filteredCommands,
    colorByState,
    onTagChange,
    onKeywordChange,
    onOpenLog,
    onOpenTerminal,
    onOpenContextMenu,
    onActionError,
    onTogglePreset,
    demoPresetInstalled,
    onImportDemoCommands,
    onCleanupDemoCommands,
    onImportDirectoryCommands,
    showDemoHint,
    onDismissDemoHint
  } = props

  const [hoveredCommand, setHoveredCommand] = useState<string | null>(null)

  return (
    <div data-testid="home-page" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Panel style={{ padding: '12px 16px' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xs)',
                background: 'color-mix(in srgb, var(--panel-soft) 65%, transparent)',
                opacity: 0.9
              }}
            >
              <input
                data-testid="home-search"
                style={{ 
                  ...inputStyle, 
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: 'transparent',
                  padding: '7px 32px 7px 10px',
                  width: '100%',
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  transition: 'all 0.2s ease'
                }}
                placeholder="搜索命令或标签..."
                value={keyword}
                onChange={(e) => onKeywordChange(e.target.value)}
              />
              {keyword && (
                <button
                  onClick={() => onKeywordChange('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                  borderRadius: 'var(--radius-pill)',
                    transition: 'background 0.2s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--panel-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
            <div style={{ 
              display: 'flex',
              gap: 4,
              background: 'var(--panel-soft)',
              padding: 2, 
              borderRadius: 'var(--radius-sm)',
              justifySelf: 'end'
            }}>
              {config.presets.map((preset) => (
                <button
                  data-testid={`preset-${preset.name}`}
                  key={preset.name}
                  style={{ 
                    ...buttonStyle('primary'), 
                    borderRadius: 'var(--radius-xs)',
                    padding: '6px 14px',
                    fontSize: 12,
                    border: 'none',
                    boxShadow: 'none'
                  }}
                  onClick={async () => {
                    try {
                      const hasRunning = preset.sequence.some((item) => {
                        const state = statusMap[item.command]?.state
                        return state === 'running' || state === 'restarting'
                      })
                      await onTogglePreset(preset.name, hasRunning ? 'stop' : 'start')
                    } catch (error) {
                      onActionError(error instanceof Error ? error.message : String(error))
                    }
                  }}
                >
                  {preset.sequence.some((item) => {
                    const state = statusMap[item.command]?.state
                    return state === 'running' || state === 'restarting'
                  })
                    ? `停止 ${preset.name}`
                    : `启动 ${preset.name}`}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                minHeight: 32
              }}
            >
            {tags.map((tag) => (
              <button 
                data-testid={`tag-${tag}`} 
                key={tag} 
                style={{ ...chipStyle(activeTag === tag), borderRadius: 'var(--radius-xs)', padding: '3px 10px' }} 
                onClick={() => onTagChange(tag)}
              >
                {tag}
              </button>
            ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, justifySelf: 'end', marginTop: 2 }}>
            <button
              data-testid="demo-config-toggle"
              style={{
                ...chipStyle(false),
                borderRadius: 'var(--radius-xs)',
                padding: '3px 10px',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
              onClick={async () => {
                try {
                  if (demoPresetInstalled) await onCleanupDemoCommands()
                  else await onImportDemoCommands()
                } catch (error) {
                  onActionError(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              {demoPresetInstalled ? '清理演示命令' : '导入演示命令'}
            </button>
            <button
              data-testid="import-directory-trigger"
              style={{
                ...chipStyle(false),
                borderRadius: 'var(--radius-xs)',
                padding: '3px 10px',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
              onClick={async () => {
                try {
                  await onImportDirectoryCommands()
                } catch (error) {
                  onActionError(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              导入目录
            </button>
            </div>
          </div>
          {showDemoHint && (
            <div
              data-testid="demo-hint"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-default))',
                background: 'color-mix(in srgb, var(--accent) 10%, var(--panel-soft))'
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                新手建议：先点 <strong style={{ color: 'var(--text)' }}>导入演示命令</strong>，即可体验后台任务、交互终端和日志分析全流程。
              </div>
              <button
                data-testid="demo-hint-dismiss"
                style={{ ...buttonStyle('muted'), padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                onClick={onDismissDemoHint}
              >
                知道了
              </button>
            </div>
          )}
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
        {filteredCommands.map((cmd) => {
          const mode = cmd.mode || 'service'
          const status = statusMap[cmd.name]
          const state = mode === 'terminal' ? (terminalStatusMap[cmd.name] || 'idle') : (status?.state ?? 'idle')
          const isRunning = state === 'running' || state === 'restarting'
          const statusLabel = getProcessStateLabel(state)
          const statusColor = colorByState(state)
          const runtimeHint =
            mode === 'terminal'
              ? isRunning ? '正在运行' : ''
              : status?.message

          const modeIcon = mode === 'terminal' ? <TerminalIcon size={14} /> : <ServiceIcon size={14} />
          
          // 根据状态生成半透明背景色
          const cardBg = state === 'idle' 
            ? 'var(--panel)' 
            : `color-mix(in srgb, ${statusColor} 7%, transparent)`

          return (
            <Panel 
              key={cmd.name} 
              soft 
              style={{ 
                padding: 12, 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 10, 
                minHeight: 130, 
                background: cardBg,
                transform: hoveredCommand === cmd.name ? 'translateY(-1px)' : 'translateY(0)',
                boxShadow: hoveredCommand === cmd.name ? 'var(--shadow-hover)' : undefined,
                transition: 'all 0.2s cubic-bezier(0.2, 0, 0, 1)',
                border: `1px solid ${
                  isRunning || state === 'error' 
                    ? `color-mix(in srgb, ${statusColor} 20%, transparent)` 
                    : hoveredCommand === cmd.name ? 'var(--border)' : 'var(--border-subtle)'
                }`,
                cursor: 'pointer'
              }}
            >
              <div
                data-testid={`command-row-${cmd.name}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}
                onMouseEnter={() => setHoveredCommand(cmd.name)}
                onMouseLeave={() => setHoveredCommand(null)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onOpenContextMenu({ x: event.clientX, y: event.clientY, commandName: cmd.name })
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span 
                        title={mode === 'terminal' ? '命令交互窗口' : '后台服务模式'} 
                        style={{ display: 'flex', color: isRunning ? statusColor : 'var(--muted)', opacity: isRunning ? 1 : 0.7 }}
                      >
                        {modeIcon}
                      </span>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{cmd.name}</div>
                    </div>
                    {runtimeHint && <div style={{ color: 'var(--muted)', fontSize: 11, opacity: 0.8 }}>{runtimeHint}</div>}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {status?.pid ? (
                    <MetaPill label="PID" value={String(status.pid)} />
                  ) : null}
                  {typeof status?.exitCode === 'number' && !isRunning ? (
                    <MetaPill label="状态码" value={String(status.exitCode)} tone={status.exitCode === 0 ? 'normal' : 'err'} />
                  ) : null}
                  {typeof status?.restarts === 'number' && status.restarts > 0 ? (
                    <MetaPill label="已重试" value={`${status.restarts}次`} tone="warn" />
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    data-testid={`command-run-${cmd.name}`}
                    style={{ 
                      ...buttonStyle('muted'),
                      flex: 2, 
                      padding: '5px 0', 
                      fontSize: 12, 
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid color-mix(in srgb, var(--accent) 32%, var(--border-default))',
                      background: 'color-mix(in srgb, var(--accent) 10%, var(--panel))',
                      color: 'var(--text)',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        if (mode === 'terminal') {
                          onOpenTerminal(cmd.name)
                          return
                        }
                        if (isRunning) {
                          onOpenLog(cmd.name)
                          return
                        }
                        await window.api.processStart(cmd.name)
                        onOpenLog(cmd.name)
                      } catch (error) {
                        onActionError(error instanceof Error ? error.message : String(error))
                      }
                    }}
                  >
                    {isRunning ? <ListIcon size={12} /> : <PlayIcon size={12} />}
                    {mode === 'terminal' ? (isRunning ? '继续会话' : '打开窗口') : isRunning ? '查看日志' : '快捷启动'}
                  </button>
                  {isRunning ? (
                    <button
                      data-testid={`command-stop-${cmd.name}`}
                      style={{ 
                        ...buttonStyle('muted'), 
                        padding: '5px 10px', 
                        fontSize: 12, 
                        borderRadius: 'var(--radius-xs)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          if (mode === 'terminal') await window.api.terminalStop(cmd.name)
                          else await window.api.processStop(cmd.name)
                        } catch (error) {
                          onActionError(error instanceof Error ? error.message : String(error))
                        }
                      }}
                    >
                      <StopIcon size={12} />
                      停止运行
                    </button>
                  ) : null}
                  <button
                    data-testid={`command-more-${cmd.name}`}
                    style={{ ...buttonStyle('muted'), padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-xs)' }}
                    onClick={(event) => {
                      event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      onOpenContextMenu({
                        x: Math.round(rect.right),
                        y: Math.round(rect.bottom + 4),
                        commandName: cmd.name
                      })
                    }}
                  >
                    更多操作
                  </button>
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      {/* 悬浮图例 (右下角) */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          display: 'flex',
          gap: 20,
          padding: '10px 20px',
          background: 'color-mix(in srgb, var(--panel) 70%, transparent)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderRadius: 32,
          border: '1px solid color-mix(in srgb, var(--border-subtle) 50%, white 10%)',
          boxShadow: 'var(--shadow-card)',
          zIndex: 10,
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-dim)',
          pointerEvents: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ok)' }} />
          <span>正在运行 / 正在重启</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--err)' }} />
          <span>运行异常</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--muted)' }} />
          <span>已停止 / 未启动</span>
        </div>
      </div>
    </div>
  )
}

function MetaPill({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' | 'err' }) {
  const toneColorMap = {
    normal: 'var(--muted)',
    warn: 'var(--warn)',
    err: 'var(--err)'
  }
  const toneBgMap = {
    normal: 'var(--panel-soft)',
    warn: 'color-mix(in srgb, var(--warn) 12%, transparent)',
    err: 'color-mix(in srgb, var(--err) 12%, transparent)'
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        border: `1px solid color-mix(in srgb, ${toneColorMap[tone]} 20%, transparent)`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 10,
        background: toneBgMap[tone],
        color: toneColorMap[tone],
        fontWeight: 500
      }}
    >
      <span style={{ opacity: 0.8 }}>{label}</span>
      <strong style={{ fontSize: 10, color: 'var(--text)', opacity: 0.9 }}>{value}</strong>
    </span>
  )
}
