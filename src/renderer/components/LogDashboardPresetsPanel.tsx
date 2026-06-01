import { useEffect, useState } from 'react'
import type { LogViewPreset } from '../../shared/types'

const MUTED_GRADIENTS = [
  'linear-gradient(135deg, #3b4a5c, #4a5568)',
  'linear-gradient(135deg, #4a4458, #5b4f6a)',
  'linear-gradient(135deg, #3d5a5a, #4a6b6b)',
  'linear-gradient(135deg, #5c4a3b, #6b5a4a)',
  'linear-gradient(135deg, #3b4a6b, #4a5a7c)',
  'linear-gradient(135deg, #5a4a5c, #6b5a6d)',
  'linear-gradient(135deg, #4a5a4a, #5b6b5b)',
  'linear-gradient(135deg, #5c5040, #6d6050)'
]

function getGradient(index: number): string {
  return MUTED_GRADIENTS[index % MUTED_GRADIENTS.length]
}

export function LogDashboardPresetsPanel({
  logViewPresets,
  onOpenPreset,
  onRenamePreset,
  onDeletePreset
}: {
  logViewPresets: LogViewPreset[]
  onOpenPreset: (name: string) => void
  onRenamePreset: (oldName: string, nextName: string) => void
  onDeletePreset: (name: string) => void
}) {
  const [sidebarOffset, setSidebarOffset] = useState(() => {
    return window.localStorage.getItem('sidebar.iconOnly') === '1' ? 56 : 216
  })
  const [editingPresetName, setEditingPresetName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')

  useEffect(() => {
    const syncOffset = () => {
      const next = window.localStorage.getItem('sidebar.iconOnly') === '1' ? 56 : 216
      setSidebarOffset((prev) => (prev === next ? prev : next))
    }
    const timer = window.setInterval(syncOffset, 400)
    return () => window.clearInterval(timer)
  }, [])

  if (logViewPresets.length === 0) return null

  return (
    <>
      {editingPresetName ? (
        <div
          style={{
            position: 'fixed',
            left: sidebarOffset + 8,
            bottom: 72,
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--panel) 90%, black)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <input
            autoFocus
            value={editingNameValue}
            onChange={(e) => setEditingNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingPresetName(null)
                setEditingNameValue('')
              }
              if (e.key === 'Enter') {
                const nextName = editingNameValue.trim()
                if (!nextName || nextName === editingPresetName) {
                  setEditingPresetName(null)
                  setEditingNameValue('')
                  return
                }
                onRenamePreset(editingPresetName, nextName)
                setEditingPresetName(null)
                setEditingNameValue('')
              }
            }}
            style={{
              width: 180,
              height: 28,
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border-default)',
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              padding: '0 8px',
              fontSize: 12
            }}
            placeholder="输入新的预设名称"
          />
          <button
            type="button"
            onClick={() => {
              const nextName = editingNameValue.trim()
              if (!nextName || nextName === editingPresetName) {
                setEditingPresetName(null)
                setEditingNameValue('')
                return
              }
              onRenamePreset(editingPresetName, nextName)
              setEditingPresetName(null)
              setEditingNameValue('')
            }}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xs)',
              background: 'color-mix(in srgb, var(--accent) 26%, var(--panel-soft))',
              color: 'var(--text)',
              height: 28,
              padding: '0 10px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingPresetName(null)
              setEditingNameValue('')
            }}
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--panel-soft)',
              color: 'var(--text-dim)',
              height: 28,
              padding: '0 8px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            取消
          </button>
        </div>
      ) : null}

      <div
        data-testid="log-dashboard-presets-panel"
        style={{
          position: 'fixed',
          left: sidebarOffset,
          bottom: 0,
          maxWidth: 'min(62vw, 920px)',
          zIndex: 12,
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          padding: '0 6px',
          scrollbarWidth: 'none',
          pointerEvents: 'auto'
        }}
      >
        {logViewPresets.map((preset, idx) => (
          <div
            key={preset.name}
            data-testid={`log-dashboard-preset-item-${preset.name}`}
            style={{
              flexShrink: 0,
              width: 120,
              height: 62,
              position: 'relative',
              overflow: 'visible'
            }}
          >
          {/* Parallelogram visual background */}
          <div
            onClick={() => onOpenPreset(preset.name)}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 6,
              overflow: 'hidden',
              cursor: 'pointer',
              transform: 'skewX(-8deg)',
              transition: 'transform 0.2s'
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: getGradient(idx) }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)' }} />
          </div>

          {/* Action buttons (outside clip area) */}
          <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2, zIndex: 3 }}>
            <button
              type="button"
              data-testid={`log-dashboard-preset-rename-${preset.name}`}
              onClick={(e) => {
                e.stopPropagation()
                setEditingPresetName(preset.name)
                setEditingNameValue(preset.name)
              }}
              style={{
                border: 'none',
                background: 'rgba(0,0,0,0.5)',
                color: 'rgba(255,255,255,0.75)',
                borderRadius: 4,
                width: 16,
                height: 16,
                fontSize: 9,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              title="重命名"
            >
              ✎
            </button>
            <button
              type="button"
              data-testid={`log-dashboard-preset-delete-${preset.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onDeletePreset(preset.name)
              }}
              style={{
                border: 'none',
                background: 'rgba(0,0,0,0.5)',
                color: 'rgba(255,255,255,0.75)',
                borderRadius: 4,
                width: 16,
                height: 16,
                fontSize: 9,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              title="删除"
            >
              ×
            </button>
          </div>

          {/* Text label (unskewed) */}
          <div
            data-testid={`log-dashboard-preset-open-${preset.name}`}
            onClick={() => onOpenPreset(preset.name)}
            style={{
              position: 'absolute',
              bottom: 7,
              left: 12,
              right: 8,
              cursor: 'pointer',
              zIndex: 2
            }}
          >
            <div
              style={{
                fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', var(--font-mono)",
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {preset.name}
            </div>
            <div
              style={{
                fontFamily: "'SF Mono', 'Cascadia Code', var(--font-mono)",
                fontSize: 8,
                color: 'rgba(255,255,255,0.6)',
                marginTop: 1
              }}
            >
              {preset.commandNames.length} commands
            </div>
          </div>
          </div>
        ))}
      </div>
    </>
  )
}
