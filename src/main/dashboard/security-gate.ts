import type { DashboardRiskLevel } from '../../shared/types'

const BLOCK_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\b(drop|truncate)\s+table\b/i,
  />\s*\/(etc|bin|sbin|usr|var|boot|root)\//i
]

const REVIEW_PATTERNS: RegExp[] = [
  /\bfind\s+\/\b/i,
  /\bexplain\s+analyze\b/i,
  /\bgrep\s+-R\b/i,
  /\biostat\b/i,
  /\bsar\b/i
]

export function inferRiskLevel(command: string): DashboardRiskLevel {
  const raw = command.trim()
  if (!raw) return 'blocked'
  if (BLOCK_PATTERNS.some((pattern) => pattern.test(raw))) return 'blocked'
  if (REVIEW_PATTERNS.some((pattern) => pattern.test(raw))) return 'review'
  return 'safe'
}

export function isCommandBlocked(command: string): boolean {
  return inferRiskLevel(command) === 'blocked'
}

