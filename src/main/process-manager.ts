import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import type { CommandConfig, ProcessOutputPayload, ProcessStatusPayload } from '../shared/types'
import { terminateProcessTreeWithEscalation } from './process-tree'

interface ProcessRecord {
  child?: ChildProcess
  restarts: number
  configHash: string
  stopping?: boolean
  pendingRestart?: CommandConfig
  health?: HealthMonitorState
}

interface HealthMonitorState {
  healthy: boolean
  failures: number
  pattern?: RegExp
  intervalTimer?: NodeJS.Timeout
  graceTimer?: NodeJS.Timeout
  inFlight?: boolean
}

type StatusEmitter = (payload: ProcessStatusPayload) => void
type OutputEmitter = (payload: ProcessOutputPayload) => void

export class ProcessManager {
  private processMap = new Map<string, ProcessRecord>()

  constructor(
    private emitStatus: StatusEmitter,
    private emitOutput: OutputEmitter
  ) {}

  private hashCommand(config: CommandConfig): string {
    return JSON.stringify({
      command: config.command,
      tags: config.tags,
      mode: config.mode,
      autoRestart: config.autoRestart,
      maxRestarts: config.maxRestarts,
      healthCheck: config.healthCheck
    })
  }

  syncConfig(commands: CommandConfig[]): void {
    const commandNames = new Set(commands.map((c) => c.name))
    for (const [name, record] of this.processMap) {
      if (!commandNames.has(name) && record.child) {
        this.emitStatus({ commandName: name, state: 'running', message: '配置删除，建议停止此进程' })
      }
    }
    for (const cmd of commands) {
      const old = this.processMap.get(cmd.name)
      const newHash = this.hashCommand(cmd)
      if (old?.child && old.configHash !== newHash) {
        this.emitStatus({ commandName: cmd.name, state: 'running', configChanged: true, message: '配置已变更，需重启生效' })
      }
      if (!old) this.processMap.set(cmd.name, { restarts: 0, configHash: newHash })
      else old.configHash = newHash
    }
  }

  getState(name: string): ProcessStatusPayload {
    const rec = this.processMap.get(name)
    if (rec?.child?.pid) return { commandName: name, state: 'running', pid: rec.child.pid, restarts: rec.restarts }
    return { commandName: name, state: 'idle', restarts: rec?.restarts ?? 0 }
  }

  start(config: CommandConfig): void {
    const record = this.processMap.get(config.name) ?? {
      restarts: 0,
      configHash: this.hashCommand(config)
    }
    if (record.child?.pid) return
    record.stopping = false
    this.clearHealthMonitor(record)

    const child = spawn(config.command, {
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })

    record.child = child
    this.processMap.set(config.name, record)
    this.emitStatus({ commandName: config.name, state: 'running', pid: child.pid, restarts: record.restarts })

    child.stdout?.on('data', (buf) => {
      const line = String(buf)
      this.emitOutput({ commandName: config.name, line, stream: 'stdout', at: Date.now() })
      this.onProcessOutputForHealth(config, record, line)
    })
    child.stderr?.on('data', (buf) => {
      const line = String(buf)
      this.emitOutput({ commandName: config.name, line, stream: 'stderr', at: Date.now() })
      this.onProcessOutputForHealth(config, record, line)
    })
    this.startHealthMonitor(config, record, child)
    child.on('exit', (code, signal) => {
      const wasStopping = Boolean(record.stopping)
      const restartAfterStop = record.pendingRestart
      record.stopping = false
      record.pendingRestart = undefined
      record.child = undefined
      this.clearHealthMonitor(record)

      if (restartAfterStop) {
        this.emitStatus({
          commandName: config.name,
          state: 'restarting',
          restarts: record.restarts,
          message: '手动重启中'
        })
        this.start(restartAfterStop)
        return
      }

      // SIGTERM/SIGKILL after manual stop should be treated as clean stop.
      if (wasStopping || signal === 'SIGTERM' || signal === 'SIGKILL') {
        this.emitStatus({
          commandName: config.name,
          state: 'idle',
          restarts: record.restarts,
          message: '已手动停止'
        })
        return
      }

      const shouldRestart = Boolean(config.autoRestart) && code !== 0 && record.restarts < (config.maxRestarts ?? 3)
      if (shouldRestart) {
        record.restarts += 1
        this.emitStatus({
          commandName: config.name,
          state: 'restarting',
          restarts: record.restarts,
          message: `异常退出，准备重启（${record.restarts}/${config.maxRestarts ?? 3}）`
        })
        setTimeout(() => this.start(config), 1500)
        return
      }
      this.emitStatus({
        commandName: config.name,
        state: code === 0 ? 'idle' : 'error',
        restarts: record.restarts,
        exitCode: code ?? undefined,
        message: code === 0 ? '已停止' : `退出码 ${code ?? -1}`
      })
    })
  }

  stop(name: string): void {
    const record = this.processMap.get(name)
    if (!record?.child?.pid) return
    const pid = record.child.pid
    record.stopping = true
    this.emitStatus({ commandName: name, state: 'running', pid, restarts: record.restarts, message: '停止中...' })
    void this.stopProcessTree(name, record, pid)
  }

  restart(config: CommandConfig): void {
    const record = this.processMap.get(config.name)
    if (!record?.child?.pid) {
      this.start(config)
      return
    }
    record.pendingRestart = config
    this.stop(config.name)
  }

  async stopAllRunning(): Promise<void> {
    const tasks: Array<Promise<void>> = []
    for (const [name, record] of this.processMap) {
      const pid = record.child?.pid
      if (!pid) continue
      record.stopping = true
      record.pendingRestart = undefined
      this.emitStatus({ commandName: name, state: 'running', pid, restarts: record.restarts, message: '应用退出中，正在停止...' })
      tasks.push(this.stopProcessTree(name, record, pid))
    }
    if (tasks.length === 0) return
    await Promise.allSettled(tasks)
  }

  private async stopProcessTree(name: string, record: ProcessRecord, pid: number): Promise<void> {
    const child = record.child
    if (!child) return
    let exited = false
    const onExit = () => {
      exited = true
    }
    child.once('exit', onExit)
    try {
      await terminateProcessTreeWithEscalation(pid, () => exited || record.child !== child, 1200)
      if (!exited && record.child === child) {
        this.emitStatus({
          commandName: name,
          state: 'running',
          pid,
          restarts: record.restarts,
          message: '已发送强制终止信号，等待进程退出事件...'
        })
      }
    } finally {
      child.removeListener('exit', onExit)
    }
  }

  private onProcessOutputForHealth(config: CommandConfig, record: ProcessRecord, line: string): void {
    const check = config.healthCheck
    const monitor = record.health
    if (!check || check.type !== 'log' || !monitor?.pattern || !record.child?.pid) return
    monitor.pattern.lastIndex = 0
    if (!monitor.pattern.test(line)) return
    if (!monitor.healthy) {
      monitor.healthy = true
      monitor.failures = 0
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: record.child.pid,
        restarts: record.restarts,
        message: `健康检查通过：检测到日志 "${check.pattern ?? ''}"`
      })
    }
  }

  private startHealthMonitor(config: CommandConfig, record: ProcessRecord, child: ChildProcess): void {
    const check = config.healthCheck
    if (!check || (config.mode || 'service') !== 'service') return
    const monitor: HealthMonitorState = { healthy: false, failures: 0 }
    record.health = monitor
    const graceMs = Math.max(1, check.startupGraceSec ?? 12) * 1000

    if (check.type === 'log') {
      const pattern = this.compileHealthPattern(check.pattern)
      if (!pattern) {
        this.emitStatus({
          commandName: config.name,
          state: 'running',
          pid: child.pid,
          restarts: record.restarts,
          message: '健康检查配置无效：log 模式缺少可用 pattern'
        })
        return
      }
      monitor.pattern = pattern
      monitor.graceTimer = setTimeout(() => {
        if (record.child !== child || monitor.healthy) return
        this.emitStatus({
          commandName: config.name,
          state: 'running',
          pid: child.pid,
          restarts: record.restarts,
          message: `健康检查未通过：${check.startupGraceSec ?? 12}s 内未检测到日志 "${check.pattern}"`
        })
      }, graceMs)
      return
    }

    const host = check.host || '127.0.0.1'
    const port = check.port
    if (!port || !Number.isFinite(port) || port <= 0 || port > 65535) {
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: child.pid,
        restarts: record.restarts,
        message: '健康检查配置无效：port 模式需要合法 port'
      })
      return
    }
    const intervalMs = Math.max(1, check.intervalSec ?? 5) * 1000
    const failureThreshold = Math.max(1, check.failureThreshold ?? 2)
    const runCheck = async () => {
      if (monitor.inFlight || record.child !== child) return
      monitor.inFlight = true
      try {
        const ok = await this.probeTcpPort(host, port)
        if (record.child !== child) return
        if (ok) {
          const wasUnhealthy = !monitor.healthy
          monitor.healthy = true
          monitor.failures = 0
          if (wasUnhealthy) {
            this.emitStatus({
              commandName: config.name,
              state: 'running',
              pid: child.pid,
              restarts: record.restarts,
              message: `健康检查通过：${host}:${port} 可连接`
            })
          }
          return
        }
        monitor.failures += 1
        if (monitor.failures >= failureThreshold && monitor.healthy) {
          monitor.healthy = false
          this.emitStatus({
            commandName: config.name,
            state: 'running',
            pid: child.pid,
            restarts: record.restarts,
            message: `健康检查告警：连续 ${monitor.failures} 次无法连接 ${host}:${port}`
          })
        }
      } finally {
        monitor.inFlight = false
      }
    }

    monitor.graceTimer = setTimeout(() => {
      if (record.child !== child || monitor.healthy || monitor.failures < failureThreshold) return
      this.emitStatus({
        commandName: config.name,
        state: 'running',
        pid: child.pid,
        restarts: record.restarts,
        message: `健康检查未通过：${check.startupGraceSec ?? 12}s 内无法连接 ${host}:${port}`
      })
    }, graceMs)
    void runCheck()
    monitor.intervalTimer = setInterval(() => {
      void runCheck()
    }, intervalMs)
  }

  private clearHealthMonitor(record: ProcessRecord): void {
    if (!record.health) return
    if (record.health.intervalTimer) clearInterval(record.health.intervalTimer)
    if (record.health.graceTimer) clearTimeout(record.health.graceTimer)
    record.health = undefined
  }

  private compileHealthPattern(raw?: string): RegExp | undefined {
    if (!raw || !raw.trim()) return undefined
    try {
      return new RegExp(raw)
    } catch {
      return undefined
    }
  }

  private probeTcpPort(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port })
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(1200)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
      socket.once('close', () => {
        if (!done) finish(false)
      })
    })
  }
}
