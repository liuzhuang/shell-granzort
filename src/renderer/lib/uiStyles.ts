import type { CSSProperties } from 'react'
const radiusMd = 'var(--radius-sm)'
const radiusSm = 'var(--radius-xs)'
const radiusPill = 'var(--radius-pill)'
const borderDefault = '1px solid var(--border-default)'
const borderStrong = '1px solid var(--border-strong)'

export const inputStyle: CSSProperties = {
  width: '100%',
  border: borderDefault,
  borderRadius: radiusMd,
  background: 'var(--panel)',
  padding: '12px 16px',
  fontSize: '16px',
  outline: 'none',
  color: 'var(--text)',
  fontFamily: 'var(--font-ui)',
  transition: 'border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease'
}

export function chipStyle(active: boolean): CSSProperties {
  return {
    border: active ? borderStrong : borderDefault,
    borderRadius: radiusSm,
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 600,
    background: active ? 'var(--panel)' : 'var(--panel-soft)',
    color: active ? 'var(--text)' : 'var(--muted)',
    cursor: 'pointer',
    transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease'
  }
}

export function buttonStyle(variant: 'primary' | 'muted' | 'warn' | 'danger'): CSSProperties {
  if (variant === 'primary') {
    return {
      border: '1px solid var(--text)',
      borderRadius: radiusMd,
      padding: '8px 14px',
      fontSize: '12px',
      fontWeight: 700,
      background: 'var(--text)',
      color: 'var(--panel)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease'
    }
  }
  if (variant === 'warn') {
    return {
      border: borderDefault,
      borderRadius: radiusMd,
      padding: '8px 12px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'color-mix(in srgb, var(--warn) 12%, var(--panel))',
      color: 'var(--warn)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease'
    }
  }
  if (variant === 'danger') {
    return {
      border: borderDefault,
      borderRadius: radiusMd,
      padding: '8px 12px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'color-mix(in srgb, var(--err) 12%, var(--panel))',
      color: 'var(--err)',
      fontFamily: 'var(--font-ui)',
      cursor: 'pointer',
      transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease'
    }
  }
  return {
    border: borderDefault,
    borderRadius: radiusMd,
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 500,
    background: 'var(--panel)',
    color: 'var(--text)',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    transition: 'transform 120ms ease, background-color 150ms ease, border-color 150ms ease'
  }
}
