import { useEffect, useState, type CSSProperties } from 'react'

/** 收起为仅图标（左栏 + 向内箭头） */
function SidebarCollapseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </svg>
  )
}

/** 从仅图标展开（左栏 + 向外箭头） */
function SidebarExpandIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </svg>
  )
}
import type { AppPage } from '../hooks/useNavigation'
import { SystemEventTicker } from './SystemEventTicker'

const SIDEBAR_ICON_ONLY_KEY = 'sidebar.iconOnly'
const SIDEBAR_WIDTH_EXPANDED = 216
const SIDEBAR_WIDTH_ICON_ONLY = 56

function readIconOnlyPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_ICON_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

function formatVersionShort(raw: string): string {
  if (!raw) return '…'
  const s = raw.trim().replace(/^v/i, '')
  const [a, b] = s.split('.')
  if (a && b !== undefined) return `v${a}.${b}`
  return `v${s.slice(0, 5)}`
}

interface SidebarProps {
  page: AppPage
  onChange: (page: AppPage) => void
  appVersion: string
  onCheckUpdate?: () => void
  tickerEvents: string[]
}

export function Sidebar({ page, onChange, appVersion, onCheckUpdate, tickerEvents }: SidebarProps) {
  const [iconOnly, setIconOnly] = useState(readIconOnlyPreference)

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_ICON_ONLY_KEY, iconOnly ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [iconOnly])

  const tabTestIdById: Record<string, string> = {
    home: 'tab-home',
    query: 'tab-log-analysis',
    monitoring: 'tab-monitoring',
    editor: 'tab-editor'
  }

  const items = [
    {
      id: 'home',
      label: '命令列表',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      )
    },
    {
      id: 'query',
      label: 'AI日志',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      )
    },
    {
      id: 'monitoring',
      label: 'AI服务器监控',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="m7 15 4-4 3 3 5-7" />
        </svg>
      )
    },
    {
      id: 'editor',
      label: '编辑配置文件',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M10 13l-2 2 2 2" />
          <path d="M14 17l2-2-2-2" />
        </svg>
      )
    }
  ]

  const isActive = (id: string) => {
    if (id === 'home') return page === 'home' || page === 'log' || page === 'terminal'
    return page === id
  }

  const w = iconOnly ? SIDEBAR_WIDTH_ICON_ONLY : SIDEBAR_WIDTH_EXPANDED
  const versionTitle = appVersion ? `v${appVersion} Stable` : ''

  const toggleIconOnlyStyle: CSSProperties = {
    flexShrink: 0,
    border: 'none',
    background: 'transparent',
    padding: 2,
    margin: 0,
    cursor: 'pointer',
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
    opacity: 0.72,
    transition: 'opacity 140ms ease, color 140ms ease'
  }

  return (
    <div
      data-sidebar-collapsed={iconOnly ? 'true' : 'false'}
      style={{
        width: w,
        minWidth: w,
        flexShrink: 0,
        height: '100%',
        background: 'var(--panel)',
        borderRight: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        padding: iconOnly ? '14px 6px' : '16px 12px',
        gap: iconOnly ? 12 : 20,
        transition: 'width 180ms ease, min-width 180ms ease, padding 180ms ease'
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: iconOnly ? 'column' : 'row',
          alignItems: iconOnly ? 'center' : 'flex-start',
          justifyContent: iconOnly ? 'center' : 'space-between',
          gap: iconOnly ? 8 : 0,
          padding: iconOnly ? '0 2px' : '0 8px',
          marginBottom: iconOnly ? 8 : 16
        }}
      >
        {iconOnly ? (
          <>
            <div
              title="Shell 终端"
              style={{
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: -0.5,
                color: 'var(--text)',
                lineHeight: 1
              }}
            >
              S<span style={{ color: 'var(--accent)' }}>.</span>
            </div>
            <button
              type="button"
              aria-expanded={false}
              aria-label="展开侧栏"
              title="展开侧栏"
              onClick={() => setIconOnly(false)}
              style={toggleIconOnlyStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.72'
                e.currentTarget.style.color = 'var(--muted)'
              }}
            >
              <SidebarExpandIcon />
            </button>
          </>
        ) : (
          <>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: -0.8, color: 'var(--text)', lineHeight: 1.2 }}>
                Shell 终端
                <span style={{ color: 'var(--accent)', marginLeft: 2 }}>.</span>
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--muted)',
                  marginTop: 4,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  opacity: 0.9,
                  textTransform: 'uppercase'
                }}
              >
                SHELL COMMAND CENTER
              </div>
            </div>
            <button
              type="button"
              aria-expanded
              aria-label="仅显示图标"
              title="仅显示图标"
              onClick={() => setIconOnly(true)}
              style={{
                ...toggleIconOnlyStyle,
                alignSelf: 'flex-start',
                marginTop: 2
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.72'
                e.currentTarget.style.color = 'var(--muted)'
              }}
            >
              <SidebarCollapseIcon />
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => {
          const active = isActive(item.id)
          return (
            <button
              key={item.id}
              data-testid={tabTestIdById[item.id]}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => onChange(item.id as AppPage)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: iconOnly ? 'center' : 'flex-start',
                gap: iconOnly ? 0 : 10,
                padding: iconOnly ? '10px 8px' : '8px 12px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: active ? 'var(--panel-soft)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition:
                  'background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard), box-shadow var(--motion-slow) var(--ease-out-strong)',
                boxShadow: active ? 'var(--shadow-card)' : 'none'
              }}
              className="sidebar-nav-button"
            >
              <span style={{ color: active ? 'var(--accent)' : 'var(--muted)', display: 'flex', flexShrink: 0 }}>{item.icon}</span>
              {!iconOnly ? item.label : null}
            </button>
          )
        })}
      </div>

      <div
        style={{
          marginTop: 'auto',
          padding: iconOnly ? '0 2px' : '0 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: iconOnly ? 6 : 8,
          alignItems: iconOnly ? 'stretch' : 'stretch',
          minWidth: 0
        }}
      >
        <SystemEventTicker events={tickerEvents} compact={iconOnly} />
        {iconOnly ? (
          <button
            type="button"
            data-testid="sidebar-check-update"
            aria-label="检查更新"
            title="检查更新"
            onClick={() => onCheckUpdate?.()}
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              background: 'transparent',
              padding: '6px 0',
              margin: 0,
              color: 'var(--muted)',
              opacity: 0.55,
              cursor: 'pointer',
              transition:
                'opacity var(--motion-normal) var(--ease-standard), background-color var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.85'
              e.currentTarget.style.background = 'var(--panel-soft)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.55'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            data-testid="sidebar-check-update"
            onClick={() => onCheckUpdate?.()}
            style={{
              alignSelf: 'flex-start',
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              fontSize: 10,
              lineHeight: 1.4,
              color: 'var(--muted)',
              opacity: 0.55,
              cursor: 'pointer',
              fontWeight: 500,
              letterSpacing: '0.03em',
              transition: 'opacity var(--motion-normal) var(--ease-standard), color var(--motion-normal) var(--ease-standard)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.85'
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.textUnderlineOffset = '3px'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.55'
              e.currentTarget.style.textDecoration = 'none'
            }}
          >
            检查更新
          </button>
        )}
        <div
          data-testid="sidebar-app-version"
          title={versionTitle}
          style={{
            fontSize: iconOnly ? 9 : 11,
            color: 'var(--text-dim)',
            padding: iconOnly ? '6px 4px' : '12px',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--panel-soft)',
            opacity: 0.7,
            textAlign: 'center',
            lineHeight: iconOnly ? 1.35 : 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: iconOnly ? 'nowrap' : 'normal',
          }}
        >
          {appVersion ? (iconOnly ? formatVersionShort(appVersion) : `v${appVersion} Stable`) : '…'}
        </div>
      </div>
    </div>
  )
}
