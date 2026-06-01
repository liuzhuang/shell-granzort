import { useState } from 'react'
import type { CommandConfig, LogViewPreset } from '../../shared/types'
import type { RuntimeStatus } from '../lib/view-models'
import { buttonStyle } from '../lib/uiStyles'

export function BatchLogModal({
  commands,
  logViewPresets,
  statusMap,
  onConfirm,
  onSavePreset,
  onClose
}: {
  commands: CommandConfig[]
  logViewPresets: LogViewPreset[]
  statusMap: Record<string, RuntimeStatus>
  onConfirm: (selectedNames: string[]) => void
  onSavePreset: (presetName: string, selectedNames: string[]) => void
  onClose: () => void
}) {
  const serviceCommands = commands.filter((cmd) => (cmd.mode || 'service') === 'service')
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const cmd of serviceCommands) {
      const state = statusMap[cmd.name]?.state
      init[cmd.name] = state === 'running' || state === 'restarting' || state === 'error'
    }
    return init
  })

  const selectedCount = Object.values(selected).filter(Boolean).length
  const [newPresetName, setNewPresetName] = useState('')

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const cmd of serviceCommands) {
      next[cmd.name] = checked
    }
    setSelected(next)
  }

  const selectedNames = serviceCommands.filter((cmd) => selected[cmd.name]).map((cmd) => cmd.name)

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.56)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2200
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="日志看板"
        data-testid="batch-log-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '92vw',
          maxHeight: '80vh',
          background: 'var(--panel)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-hover)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>日志看板</div>
          <button type="button" style={buttonStyle('muted')} onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            选择要同时查看日志的命令（仅显示 service 模式命令）：
          </div>
          {serviceCommands.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>
              当前筛选条件下没有 service 模式的命令
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    data-testid="batch-log-select-all"
                    checked={selectedCount === serviceCommands.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                  全选 ({selectedCount}/{serviceCommands.length})
                </label>
              </div>

              <div style={{ overflow: 'auto', maxHeight: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {serviceCommands.map((cmd) => {
                  const state = statusMap[cmd.name]?.state ?? 'idle'
                  const stateLabel = state === 'running' ? '运行中' : state === 'error' ? '异常' : state === 'restarting' ? '重启中' : '空闲'
                  const stateColor = state === 'running' || state === 'restarting' ? 'var(--ok)' : state === 'error' ? 'var(--err)' : 'var(--muted)'
                  return (
                    <label
                      key={cmd.name}
                      data-testid={`batch-log-item-${cmd.name}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-xs)',
                        border: `1px solid ${selected[cmd.name] ? 'color-mix(in srgb, var(--accent) 30%, var(--border-default))' : 'var(--border-subtle)'}`,
                        background: selected[cmd.name] ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color var(--motion-normal) var(--ease-standard), border-color var(--motion-normal) var(--ease-standard)'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[cmd.name]}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [cmd.name]: e.target.checked }))}
                      />
                      <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{cmd.name}</span>
                        <span style={{ fontSize: 11, color: stateColor, flexShrink: 0 }}>{stateLabel}</span>
                      </div>
                    </label>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  data-testid="batch-log-preset-name"
                  value={newPresetName}
                  onChange={(event) => setNewPresetName(event.target.value)}
                  placeholder="输入预设名称，如：后端核心组"
                  style={{
                    flex: 1,
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--panel)',
                    color: 'var(--text)',
                    padding: '8px 10px',
                    fontSize: 12
                  }}
                />
                <button
                  type="button"
                  data-testid="batch-log-save-preset"
                  style={buttonStyle(selectedCount > 0 ? 'primary' : 'muted')}
                  disabled={selectedCount === 0}
                  onClick={() => {
                    const customName = newPresetName.trim()
                    const presetName = customName || generateAnimePresetName(new Set(logViewPresets.map((item) => item.name)))
                    onSavePreset(presetName, selectedNames)
                    setNewPresetName('')
                  }}
                >
                  保存预设（可自动命名）
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button type="button" style={buttonStyle('muted')} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            data-testid="batch-log-confirm"
            style={buttonStyle(selectedCount > 0 ? 'primary' : 'muted')}
            disabled={selectedCount === 0}
            onClick={() => {
              const names = serviceCommands.filter((cmd) => selected[cmd.name]).map((cmd) => cmd.name)
              if (names.length > 0) onConfirm(names)
            }}
          >
            打开看板 ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  )
}

const ANIME_PRESET_FRAGMENTS = [
  '月に代わって',
  '自由の翼',
  'Plus Ultra',
  '影分身',
  '命を燃やせ',
  '星屑远征',
  '王の力',
  '风之呼吸',
  '螺旋之力',
  '零之镇魂歌',
  '赛博冲刺',
  '钢之意志'
]

function generateAnimePresetName(existingNames: Set<string>): string {
  const now = Date.now().toString(36).slice(-4).toUpperCase()
  for (let i = 0; i < 12; i += 1) {
    const first = ANIME_PRESET_FRAGMENTS[Math.floor(Math.random() * ANIME_PRESET_FRAGMENTS.length)]
    const second = ANIME_PRESET_FRAGMENTS[Math.floor(Math.random() * ANIME_PRESET_FRAGMENTS.length)]
    const name = `${first}·${second}-${now}`
    if (!existingNames.has(name)) return name
  }
  let index = 1
  while (existingNames.has(`动漫日志组-${now}-${index}`)) index += 1
  return `动漫日志组-${now}-${index}`
}
