import type { CSSProperties, ReactNode } from 'react'

export function Panel({ children, soft = false, style, className }: { children: ReactNode; soft?: boolean; style?: CSSProperties; className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: soft ? 'var(--panel-soft)' : 'var(--panel)',
        border: `1px solid var(--border-subtle)`,
        borderRadius: soft ? 'var(--radius-md)' : 'var(--radius-lg)',
        boxShadow: soft ? 'none' : 'var(--shadow-card)',
        padding: 12,
        transition: 'border-color 150ms ease, box-shadow 200ms ease, background-color 150ms ease',
        ...style
      }}
    >
      {children}
    </div>
  )
}
