type ToastTone = 'success' | 'warn' | 'error' | 'info'

export function Toast({ text, tone = 'info' }: { text: string; tone?: ToastTone }) {
  if (!text) return null
  const styleByTone: Record<ToastTone, { background: string; color: string }> = {
    success: { background: 'color-mix(in srgb, var(--ok) 14%, var(--panel))', color: 'var(--ok)' },
    warn: { background: 'color-mix(in srgb, var(--warn) 14%, var(--panel))', color: 'var(--warn)' },
    error: { background: 'color-mix(in srgb, var(--err) 14%, var(--panel))', color: 'var(--err)' },
    info: { background: 'var(--panel-soft)', color: 'var(--text-dim)' }
  }

  return (
    <div
      data-testid="global-toast"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: styleByTone[tone].background,
        color: styleByTone[tone].color,
        border: '1px solid var(--border-default)',
        borderRadius: 14,
        padding: '10px 14px',
        fontSize: 12,
        fontFamily: 'var(--font-ui)'
      }}
    >
      {text}
    </div>
  )
}
