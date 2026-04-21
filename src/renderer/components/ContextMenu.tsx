import { useEffect } from 'react'

export interface ContextMenuItem {
  key: string
  label: string
  onClick: () => void
  tone?: 'normal' | 'warn' | 'danger'
  group?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const menuWidth = 240
  const menuMaxHeight = 420
  const margin = 12
  const clampedLeft = Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin))
  const clampedTop = Math.max(margin, Math.min(y, window.innerHeight - menuMaxHeight - margin))
  const groupedItems = items.reduce<Record<string, ContextMenuItem[]>>((acc, item) => {
    const group = item.group || '更多'
    if (!acc[group]) acc[group] = []
    acc[group].push(item)
    return acc
  }, {})
  const orderedGroups = ['快捷运行', '配置管理', '更多设置'].filter((group) => groupedItems[group]?.length)

  useEffect(() => {
    const handler = () => onClose()
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('contextmenu', handler)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  return (
    <div
      data-testid="command-context-menu"
      style={{
        position: 'fixed',
        top: clampedTop,
        left: clampedLeft,
        zIndex: 2000,
        background: 'var(--panel)',
        border: '1px solid var(--border-strong)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-card)',
        padding: 6,
        minWidth: 170,
        width: menuWidth,
        maxHeight: menuMaxHeight,
        overflowY: 'auto'
      }}
    >
      {orderedGroups.map((groupName) => (
        <div key={groupName} style={{ display: 'grid', gap: 5, marginBottom: groupName === orderedGroups[orderedGroups.length - 1] ? 0 : 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, padding: '2px 4px' }}>{groupName}</div>
          {groupedItems[groupName].map((item) => (
            <button
              key={item.key}
              onClick={(event) => {
                event.stopPropagation()
                item.onClick()
                onClose()
              }}
              style={{
                width: '100%',
                border: '1px solid var(--border-subtle)',
                textAlign: 'left',
                borderRadius: 8,
                padding: '7px 9px',
                fontSize: 12,
                fontFamily: 'var(--font-ui)',
                cursor: 'pointer',
                color: item.tone === 'danger' ? 'var(--err)' : item.tone === 'warn' ? 'var(--warn)' : 'var(--text)',
                background:
                  item.tone === 'danger'
                    ? 'color-mix(in srgb, var(--err) 14%, var(--panel))'
                    : item.tone === 'warn'
                      ? 'color-mix(in srgb, var(--warn) 14%, var(--panel))'
                      : 'var(--panel-soft)'
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
