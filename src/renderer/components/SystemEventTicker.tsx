import { useEffect, useMemo, useState } from 'react'

interface SystemEventTickerProps {
  events: string[]
  /** 窄侧栏：更小字号与内边距，避免跑马灯溢出 */
  compact?: boolean
}

export function SystemEventTicker({ events, compact }: SystemEventTickerProps) {
  const [reduceMotion, setReduceMotion] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [animating, setAnimating] = useState(false)
  const pendingEvents = useMemo(() => events.slice(cursor), [events, cursor])
  const currentText = pendingEvents[0] || ''
  const nextText = pendingEvents[1] || ''

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduceMotion(mediaQuery.matches)
    apply()
    mediaQuery.addEventListener('change', apply)
    return () => mediaQuery.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (!currentText) return
    const timer = window.setTimeout(() => {
      if (!reduceMotion && nextText) {
        setAnimating(true)
        window.setTimeout(() => {
          setCursor((prev) => prev + 1)
          setAnimating(false)
        }, 220)
        return
      }
      setCursor((prev) => prev + 1)
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [currentText, nextText, reduceMotion])

  useEffect(() => {
    setCursor((prev) => Math.min(prev, events.length))
  }, [events.length])

  if (!currentText) return null

  return (
    <div
      className={`system-ticker${compact ? ' system-ticker--compact' : ''}`}
      data-testid="sidebar-system-ticker"
      title={currentText}
    >
      {reduceMotion ? (
        <div className="system-ticker-static">{currentText}</div>
      ) : (
        <div className="system-ticker-viewport" aria-live="polite">
          <div className={`system-ticker-track-vertical ${animating ? 'is-animating' : ''}`}>
            <div className="system-ticker-line">{currentText}</div>
            <div className="system-ticker-line" aria-hidden>
              {nextText}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
