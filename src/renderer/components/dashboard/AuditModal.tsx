import { useEffect } from 'react'
import { buttonStyle } from '../../lib/uiStyles'
import type { CommandReviewItem } from '../../../shared/types'
import type { DashboardWidgetSpec } from '../../lib/dashboard-types'

interface AuditModalProps {
  widget: DashboardWidgetSpec | null
  open: boolean
  commandReviewMap: Record<string, CommandReviewItem>
  approvedTokenMap: Record<string, string>
  approvingStepId?: string
  onApprove: (widgetId: string, stepId: string, command: string) => void
  onClose: () => void
}

const riskStyle: Record<string, { color: string; bg: string; border: string }> = {
  safe: { color: 'var(--ok)', bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(34, 197, 94, 0.35)' },
  review: { color: 'var(--warn)', bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.35)' },
  blocked: { color: 'var(--err)', bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.35)' }
}

export function AuditModal({ widget, open, commandReviewMap, approvedTokenMap, approvingStepId, onApprove, onClose }: AuditModalProps) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !widget) return null

  const primaryStep = widget.probe.steps[0]
  const risk = primaryStep?.riskLevel || 'safe'
  const riskToken = riskStyle[risk] || riskStyle.safe
  const reviewKey = primaryStep ? `${widget.id}:${primaryStep.stepId}` : ''
  const reviewItem = reviewKey ? commandReviewMap[reviewKey] : undefined
  const hasApproval = Boolean(reviewKey && approvedTokenMap[reviewKey])

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.62)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1200
      }}
    >
      <div
        role="dialog"
        data-testid="dashboard-audit-modal"
        aria-modal="true"
        aria-label={`${widget.title} 指令审计`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '92vw',
          background: 'var(--panel)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-strong)',
          padding: 24,
          boxShadow: 'var(--shadow-hover)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{widget.title} - 指令审计</div>
          <button type="button" onClick={onClose} style={buttonStyle('muted')}>
            关闭
          </button>
        </div>

        <section data-testid="dashboard-audit-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>风险审计状态</div>
          <div
            data-testid="dashboard-audit-risk-badge"
            style={{
              display: 'inline-flex',
              width: 'fit-content',
              padding: '4px 9px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: riskToken.color,
              background: riskToken.bg,
              border: `1px solid ${riskToken.border}`,
              textTransform: 'uppercase'
            }}
          >
            {risk}
          </div>
          {reviewItem?.riskReason ? <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{reviewItem.riskReason}</div> : null}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>底层取数指令</div>
          <div
            data-testid="dashboard-audit-command"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: 12,
              lineHeight: 1.6,
              wordBreak: 'break-word'
            }}
          >
            {primaryStep?.command || '暂无命令'}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>解析规则</div>
          <div style={{ fontSize: 12, color: 'var(--text)' }}>
            {widget.parserRule.type}
            {widget.parserRule.pattern ? ` / ${widget.parserRule.pattern}` : ''}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>说明与逻辑</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>
            {widget.description || '暂无说明'}
          </div>
        </section>

        {primaryStep?.riskLevel === 'review' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              data-testid="dashboard-audit-approve"
              type="button"
              disabled={Boolean(approvingStepId) || hasApproval}
              onClick={() => onApprove(widget.id, primaryStep.stepId, primaryStep.command)}
              style={buttonStyle('warn')}
            >
              {hasApproval ? '已授权' : approvingStepId === primaryStep.stepId ? '授权中...' : '允许授权执行'}
            </button>
            {hasApproval ? <span style={{ fontSize: 11, color: 'var(--ok)' }}>本次已放通</span> : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={buttonStyle('muted')} onClick={onClose}>
            取消
          </button>
          <button type="button" style={buttonStyle('primary')} onClick={onClose}>
            编辑该探针
          </button>
        </div>
      </div>
    </div>
  )
}
