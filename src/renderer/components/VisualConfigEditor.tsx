import { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import { AppConfig, CommandConfig, PresetConfig, CommandMode } from '../../shared/types'
import { buttonStyle, chipStyle, inputStyle } from '../lib/uiStyles'

export type VisualConfigTab = 'commands' | 'presets' | 'settings'
type VisualTab = VisualConfigTab

const TABS: { id: VisualTab; label: string }[] = [
  { id: 'commands', label: '命令列表' },
  { id: 'presets', label: '预设列表' },
  { id: 'settings', label: '全局设置' }
]

interface VisualConfigEditorProps {
  value: string
  onChange: (value: string) => void
}

const MODES: { value: CommandMode, label: string }[] = [
  { value: 'service', label: '作为后台守护服务运行 (Service)' },
  { value: 'terminal', label: '作为交互型终端打开 (Terminal)' }
]

function splitInteractiveCommands(command: string): string[] {
  const segments = command.split('|||').map((item) => item.trim())
  return segments.some((item) => item.length > 0) ? segments : ['']
}

function joinInteractiveCommands(segments: string[]): string {
  return segments.map((item) => item.trim()).join(' ||| ')
}

function compactInteractiveSegments(segments: string[]): string[] {
  const cleaned = segments.map((item) => item.trim()).filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : ['']
}

export function VisualConfigEditor({ value, onChange }: VisualConfigEditorProps) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<VisualTab>('commands')

  // Initialize config from yaml value
  useEffect(() => {
    try {
      const parsed = yaml.load(value) as AppConfig
      // Basic validation to ensure it's an object with expected arrays
      if (parsed && typeof parsed === 'object') {
        if (!Array.isArray(parsed.commands)) parsed.commands = []
        if (!Array.isArray(parsed.presets)) parsed.presets = []
        if (!parsed.settings) parsed.settings = { llm: { endpoint: '', apiKey: '', model: '' }, themePreset: 'coder', logBufferLines: 5000 }
        if (!parsed.settings.themePreset) parsed.settings.themePreset = 'coder'
        if (!Array.isArray(parsed.settings.sshKeys)) parsed.settings.sshKeys = []
        setConfig(parsed)
        setError(null)
      }
    } catch (e) {
      setError('无法解析 YAML 配置文件，请检查格式是否正确。')
    }
  }, [value])

  // Sync config back to yaml
  const updateConfig = (newConfig: AppConfig) => {
    // Remove individual 'color' from existing commands just in case
    newConfig.commands = newConfig.commands.map(cmd => {
      const { color, ...rest } = cmd as any
      return rest as CommandConfig
    })

    setConfig(newConfig)
    try {
      const yamlStr = yaml.dump(newConfig, {
        indent: 2,
        lineWidth: -1, // Disable line wrapping
        noRefs: true
      })
      onChange(yamlStr)
    } catch (e) {
      console.error('Failed to dump yaml', e)
    }
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: 'var(--err)', textAlign: 'center' }}>
        {error}
      </div>
    )
  }

  if (!config) return null

  const handleCommandChange = (index: number, field: keyof CommandConfig, val: any) => {
    const newCommands = [...config.commands]
    const currentCmd = newCommands[index]
    const updatedCmd = { ...currentCmd, [field]: val }

    // 智能推断：如果修改的是 command，尝试自动推断 mode
    if (field === 'command' && typeof val === 'string') {
      const isTerminal = /(^|\s)(ssh|mysql|redis-cli|top|vim|htop|telnet)(\s|$)/.test(val)
      const isService = /(^|\s)(npm run|yarn|node|nodemon|pnpm|go run|python|flask)(\s|$)/.test(val)
      
      // 如果推断出明确的类型，则自动切换，减轻用户决策
      if (isTerminal) updatedCmd.mode = 'terminal'
      else if (isService) updatedCmd.mode = 'service'
    }

    newCommands[index] = updatedCmd
    updateConfig({ ...config, commands: newCommands })
  }

  const addCommand = () => {
    const newCommand: CommandConfig = {
      name: '新命令',
      command: 'echo "hello"',
      tags: [],
      mode: 'service',
      autoRestart: false
    }
    // 向前插入，保证最新添加的命令在最上方
    updateConfig({ ...config, commands: [newCommand, ...config.commands] })
  }

  const removeCommand = (index: number) => {
    const newCommands = config.commands.filter((_, i) => i !== index)
    updateConfig({ ...config, commands: newCommands })
  }

  const sshKeys = config?.settings.sshKeys || []

  const renderSshKeySelector = (cmd: CommandConfig, idx: number) => {
    const isSsh = /^\s*ssh(\s|$)/i.test(cmd.command)
    if (!isSsh) return null
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={secondaryLabelStyle}>SSH 密钥</label>
        <select
          style={{ ...selectStyle, color: 'var(--muted)' }}
          value={cmd.sshKeyId || ''}
          onChange={(e) => handleCommandChange(idx, 'sshKeyId', e.target.value || undefined)}
        >
          <option value="">不绑定密钥</option>
          {sshKeys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.label} ({key.id})
            </option>
          ))}
        </select>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          团队共享时命令写 <code style={{ fontSize: 11 }}>ssh user@host</code>，每人本地导入同名密钥后自动注入 <code style={{ fontSize: 11 }}>-i</code>。
        </p>
      </div>
    )
  }

  const handlePresetChange = (index: number, field: keyof PresetConfig, val: any) => {
    const newPresets = [...config.presets]
    newPresets[index] = { ...newPresets[index], [field]: val }
    updateConfig({ ...config, presets: newPresets })
  }

  const addPreset = () => {
    const newPreset: PresetConfig = {
      name: '新预设',
      sequence: []
    }
    // 向前插入，保证最新添加的预设在最上方
    updateConfig({ ...config, presets: [newPreset, ...config.presets] })
  }

  const removePreset = (index: number) => {
    const newPresets = config.presets.filter((_, i) => i !== index)
    updateConfig({ ...config, presets: newPresets })
  }

  const handleSettingsChange = (path: string, val: any) => {
    const newConfig = { ...config }
    if (path === 'logBufferLines') {
      newConfig.settings.logBufferLines = Number(val)
    } else if (path.startsWith('llm.')) {
      const field = path.split('.')[1] as keyof typeof config.settings.llm
      newConfig.settings.llm = { ...newConfig.settings.llm, [field]: val }
    }
    updateConfig(newConfig)
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        role="tablist"
        aria-label="配置分区"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          flexShrink: 0,
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`visual-tab-${tab.id}`}
            style={{
              ...chipStyle(activeTab === tab.id),
              borderRadius: 'var(--radius-xs)',
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              border: '1px solid',
              borderColor: activeTab === tab.id ? 'var(--accent)' : 'var(--border-default)'
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingRight: 4,
          paddingBottom: 16
        }}
      >
        {activeTab === 'commands' && (
      <section>
        <button 
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 14,
            marginBottom: 16,
            transition: 'background 0.2s',
          }}
          onClick={addCommand}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-active)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          + 增加一条新命令
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {config.commands.map((cmd, idx) => (
            <div key={idx} style={{ 
              padding: 16, 
              borderRadius: 'var(--radius-md)', 
              background: 'var(--panel-soft)', 
              border: '1px solid var(--border-default)',
              position: 'relative'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={nameLabelStyle}>名称</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 24,
                        height: 24,
                        borderRadius: 999,
                        background: 'var(--accent)',
                        color: 'var(--panel)',
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0
                      }}
                    >
                      {idx + 1}
                    </div>
                    <input
                      style={{ ...inputStyle, flex: 1, fontWeight: 700 }}
                      value={cmd.name}
                      onChange={e => handleCommandChange(idx, 'name', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={secondaryLabelStyle}>运行模式</label>
                  <select 
                    style={{ ...selectStyle, color: 'var(--muted)' }} 
                    value={cmd.mode || 'service'} 
                    onChange={e => handleCommandChange(idx, 'mode', e.target.value)}
                  >
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              {cmd.mode === 'service' || cmd.mode === 'terminal' ? (
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 12,
                    fontSize: 12,
                    color: 'var(--text)'
                  }}
                >
                  <input
                    data-testid={`visual-command-auto-restart-${idx}`}
                    type="checkbox"
                    checked={Boolean(cmd.autoRestart)}
                    onChange={(event) => handleCommandChange(idx, 'autoRestart', event.target.checked)}
                  />
                  异常退出时自动重连（最多 3 次）
                </label>
              ) : null}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <label style={{ ...secondaryLabelStyle, marginBottom: 0 }}>
                    {cmd.mode === 'terminal' ? '执行命令' : '执行命令'}
                  </label>
                  {cmd.mode === 'terminal' ? (
                    <button
                      type="button"
                      data-testid={`visual-command-plus-${idx}`}
                      style={{ ...buttonStyle('muted'), padding: '2px 8px', fontSize: 13, lineHeight: 1.2 }}
                      onClick={() => {
                        const segments = splitInteractiveCommands(cmd.command)
                        handleCommandChange(idx, 'command', joinInteractiveCommands([...segments, '']))
                      }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
                {cmd.mode === 'terminal' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {splitInteractiveCommands(cmd.command).map((segment, segmentIndex, list) => (
                      <div key={`${idx}-segment-${segmentIndex}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <input
                          data-testid={`visual-command-segment-input-${idx}-${segmentIndex}`}
                          style={{ ...inputStyle, color: 'var(--muted)' }}
                          value={segment}
                          onChange={(event) => {
                            const nextSegments = [...list]
                            nextSegments[segmentIndex] = event.target.value
                            handleCommandChange(idx, 'command', joinInteractiveCommands(nextSegments))
                          }}
                          placeholder={segmentIndex === 0 ? '例如：ssh user@host' : '例如：tail -f /path/to/log'}
                        />
                        <button
                          type="button"
                          data-testid={`visual-command-segment-remove-${idx}-${segmentIndex}`}
                          disabled={list.length <= 1}
                          style={{ ...buttonStyle('muted'), padding: '0 10px', fontSize: 14, lineHeight: 1 }}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={() => {
                            if (list.length <= 1) return
                            const nextSegments = [...list]
                            nextSegments.splice(segmentIndex, 1)
                            handleCommandChange(idx, 'command', joinInteractiveCommands(compactInteractiveSegments(nextSegments)))
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <input 
                    style={{ ...inputStyle, color: 'var(--muted)' }} 
                    value={cmd.command} 
                    onChange={e => handleCommandChange(idx, 'command', e.target.value)} 
                  />
                )}
              </div>
              {renderSshKeySelector(cmd, idx)}
              <div>
                <label style={secondaryLabelStyle}>
                  标签 (Tags) 
                  <span style={{color: 'var(--muted)', fontWeight: 'normal', textTransform: 'none', marginLeft: 4}}>
                    (选填)
                  </span>
                </label>
                <input 
                  style={{ ...inputStyle, color: 'var(--muted)' }} 
                  value={cmd.tags?.join(', ') || ''} 
                  placeholder="输入标签词用于分类和搜索（例如: 前端, 后端, util）"
                  onChange={e => handleCommandChange(idx, 'tags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} 
                />
              </div>
              <button 
                onClick={() => removeCommand(idx)}
                style={{
                  ...buttonStyle('muted'),
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  padding: '4px 8px',
                  background: 'var(--accent)',
                  border: '1px solid var(--accent-strong)',
                  color: 'var(--panel)'
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </section>
        )}

        {activeTab === 'presets' && (
      <section>
        <button 
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 14,
            marginBottom: 16,
            transition: 'background 0.2s',
          }}
          onClick={addPreset}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-active)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          + 增加一条新预设
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {config.presets.map((preset, idx) => (
            <div key={idx} style={{ 
              padding: 16, 
              borderRadius: 'var(--radius-md)', 
              background: 'var(--panel-soft)', 
              border: '1px solid var(--border-default)',
              position: 'relative'
            }}>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>预设名称</label>
                <input 
                  style={inputStyle} 
                  value={preset.name} 
                  onChange={e => handlePresetChange(idx, 'name', e.target.value)} 
                />
              </div>
              <div>
                <label style={labelStyle}>执行序列</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {preset.sequence.map((item, sIdx) => (
                    <div key={sIdx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select 
                        style={{ ...selectStyle, flex: 1 }} 
                        value={item.command}
                        onChange={e => {
                          const newSeq = [...preset.sequence]
                          newSeq[sIdx] = { ...newSeq[sIdx], command: e.target.value }
                          handlePresetChange(idx, 'sequence', newSeq)
                        }}
                      >
                        <option value="">选择命令...</option>
                        {config.commands.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <input 
                        type="number" 
                        placeholder="延迟(秒)" 
                        style={{ ...inputStyle, width: 80 }} 
                        value={item.delay || 0}
                        onChange={e => {
                          const newSeq = [...preset.sequence]
                          newSeq[sIdx] = { ...newSeq[sIdx], delay: Number(e.target.value) }
                          handlePresetChange(idx, 'sequence', newSeq)
                        }}
                      />
                      <button 
                        onClick={() => {
                          const newSeq = preset.sequence.filter((_, i) => i !== sIdx)
                          handlePresetChange(idx, 'sequence', newSeq)
                        }}
                        style={{ ...buttonStyle('danger'), padding: '4px 8px' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button 
                    style={{ ...buttonStyle('muted'), alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={() => {
                      handlePresetChange(idx, 'sequence', [...preset.sequence, { command: '', delay: 5 }])
                    }}
                  >
                    + 添加步骤
                  </button>
                </div>
              </div>
              <button 
                onClick={() => removePreset(idx)}
                style={{ ...buttonStyle('danger'), position: 'absolute', top: 12, right: 12, padding: '4px 8px' }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </section>
        )}

        {activeTab === 'settings' && (
      <section>
        <div style={{ 
          padding: 16, 
          borderRadius: 'var(--radius-md)', 
          background: 'var(--panel-soft)', 
          border: '1px solid var(--border-default)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16
        }}>
          <div>
            <label style={labelStyle}>日志缓冲行数</label>
            <input 
              type="number" 
              style={inputStyle} 
              value={config.settings.logBufferLines} 
              onChange={e => handleSettingsChange('logBufferLines', e.target.value)} 
            />
          </div>
          <div>
            <label style={labelStyle}>AI 模型 (Model)</label>
            <input 
              style={inputStyle} 
              value={config.settings.llm.model} 
              onChange={e => handleSettingsChange('llm.model', e.target.value)} 
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>AI API Key</label>
            <input 
              type="password" 
              style={inputStyle} 
              value={config.settings.llm.apiKey} 
              onChange={e => handleSettingsChange('llm.apiKey', e.target.value)} 
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={labelStyle}>API 终端节点 (Endpoint)</label>
            <input 
              style={inputStyle} 
              value={config.settings.llm.endpoint} 
              onChange={e => handleSettingsChange('llm.endpoint', e.target.value)} 
            />
          </div>
        </div>
      </section>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--muted)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.02em'
}

const secondaryLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--muted)'
}

const nameLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--text)',
  fontWeight: 700
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px'
}
