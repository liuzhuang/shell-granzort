import type { DashboardDataMap } from './dashboard-types'
import type { DashboardTab } from '../../shared/types'

const slowSqlSamples = [
  {
    time: 8.4,
    user: 'root',
    state: 'Searching',
    sql: 'SELECT * FROM large_orders ...'
  },
  {
    time: 2.1,
    user: 'admin',
    state: 'Locked',
    sql: 'UPDATE inventory SET stock = ...'
  },
  {
    time: 3.9,
    user: 'report',
    state: 'Copying to tmp table',
    sql: 'SELECT SUM(amount) FROM invoices ...'
  }
]

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function withNoise(base: number, tick: number, scale: number): number {
  const noise = Math.sin(tick / 3) * scale + Math.cos(tick / 7) * (scale * 0.55)
  return base + noise
}

function toneByPercent(value: number): 'ok' | 'warn' | 'error' {
  if (value >= 85) return 'error'
  if (value >= 70) return 'warn'
  return 'ok'
}

function textByTone(tone: 'ok' | 'warn' | 'error'): string {
  if (tone === 'error') return '存在风险'
  if (tone === 'warn') return '接近阈值'
  return '正常运行中'
}

const now = Date.now()

export const dashboardMockTab: DashboardTab = {
  id: 'ops-main',
  name: '可视化看板',
  contextLabel: 'prod-master-01',
  createdAt: now,
  updatedAt: now,
  widgets: [],
  gridLayout: []
}

export function buildMockDashboardData(tick: number): DashboardDataMap {
  const cpuValue = clampPercent(withNoise(24.8, tick, 8))
  const memoryValue = clampPercent(withNoise(62.1, tick + 3, 6))
  const diskLoad = clampPercent(withNoise(53, tick + 6, 18))
  const cpuTone = toneByPercent(cpuValue)
  const memoryTone = toneByPercent(memoryValue)
  const diskTone = toneByPercent(diskLoad)

  const slowRows = slowSqlSamples.map((item, index) => {
    const next = Math.max(1.2, item.time + Math.sin((tick + index) / 2) * 0.7)
    return [`${next.toFixed(1)}s`, item.user, item.state, item.sql]
  })

  return {
    cpu: {
      kind: 'metric',
      value: `${cpuValue.toFixed(1)}%`,
      statusText: textByTone(cpuTone),
      tone: cpuTone
    },
    memory: {
      kind: 'metric',
      value: `${memoryValue.toFixed(1)}%`,
      statusText: textByTone(memoryTone),
      tone: memoryTone
    },
    slow_sql: {
      kind: 'table',
      columns: ['Time', 'User', 'State', 'SQL Query'],
      rows: slowRows
    },
    bandwidth_trend: {
      kind: 'timeseries',
      unit: 'MB/s',
      points: Array.from({ length: 12 }).map((_, index) => ({
        label: `${index + 1}`,
        value: Number((32 + Math.sin((tick + index) / 2.4) * 10 + Math.cos((tick + index) / 5) * 4).toFixed(1))
      }))
    },
    disk_io: {
      kind: 'metric',
      value: `${diskLoad.toFixed(1)} MB/s`,
      statusText: textByTone(diskTone),
      tone: diskTone
    },
    ops_event: {
      kind: 'event',
      lines: [
        `[${new Date(Date.now() - 15_000).toLocaleTimeString()}] nginx upstream timeout warning`,
        `[${new Date(Date.now() - 9_000).toLocaleTimeString()}] mysql slow query detected (3.2s)`,
        `[${new Date(Date.now() - 3_000).toLocaleTimeString()}] cpu idle recovered to 72%`
      ]
    }
  }
}
