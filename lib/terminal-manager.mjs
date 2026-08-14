import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pty from 'node-pty'
import { appendBounded, publicError, resolveAllowedCwd, scrubbedEnvironment } from './core.mjs'

const execFileAsync = promisify(execFile)

export class TerminalManager {
  constructor(config, spawnPty = pty.spawn) {
    this.config = config
    this.spawnPty = spawnPty
    this.sessions = new Map()
    this.listeners = new Set()
  }

  list() {
    return [...this.sessions.values()].map(session => ({
      id: session.id,
      launcherId: session.launcher.id,
      label: session.launcher.label,
      cwd: session.cwd,
      pid: session.pty.pid,
      status: session.status,
      createdAt: session.createdAt,
    }))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open({ launcherId, cwd, cols, rows }, sink) {
    if (this.sessions.size >= this.config.maxTerminals) {
      const error = new Error(`terminal limit reached (${this.config.maxTerminals})`)
      error.code = 'TERMINAL_LIMIT'
      throw error
    }
    const launcher = this.config.launchers.find(item => item.id === launcherId)
    if (launcher === undefined) {
      const error = new Error(`unknown launcher "${launcherId}"`)
      error.code = 'UNKNOWN_LAUNCHER'
      throw error
    }
    const resolvedCwd = resolveAllowedCwd(cwd, this.config.allowedRoots)
    const child = this.spawnPty(this.config.shell, this.config.shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: resolvedCwd,
      env: scrubbedEnvironment({ TERM: 'xterm-256color', COLORTERM: 'truecolor', UKING_DSH_TERMINAL: '1' }),
      useConpty: process.platform === 'win32',
    })
    const id = `ut-${randomUUID()}`
    const session = {
      id,
      launcher,
      cwd: resolvedCwd,
      pty: child,
      sink,
      buffer: '',
      status: 'running',
      createdAt: new Date().toISOString(),
      closing: undefined,
      dataDisposable: undefined,
      exitDisposable: undefined,
    }
    session.dataDisposable = child.onData((data) => {
      session.buffer = appendBounded(session.buffer, data, this.config.maxBufferChars)
      try { sink({ type: 'data', data }) } catch {}
    })
    session.exitDisposable = child.onExit(({ exitCode, signal }) => {
      session.status = 'exited'
      try { sink({ type: 'exit', exitCode, signal }) } catch {}
      this.finish(session)
    })
    this.sessions.set(id, session)
    this.emitChange()
    sink({ type: 'ready', session: this.list().find(item => item.id === id) })
    if (launcher.command !== '') {
      setTimeout(() => {
        if (this.sessions.get(id) !== session || session.status !== 'running') return
        child.write(`${launcher.command}\r`)
      }, 180)
    }
    return id
  }

  write(id, data) {
    const session = this.require(id)
    if (session.status !== 'running') throw coded('SESSION_EXITED', `terminal "${id}" has exited`)
    session.pty.write(data)
  }

  resize(id, cols, rows) {
    const session = this.require(id)
    if (session.status === 'running') session.pty.resize(cols, rows)
  }

  read(id, tailChars = 4000) {
    const session = this.require(id)
    const count = Math.max(1, Math.min(Number(tailChars) || 4000, 12000))
    return {
      id,
      status: session.status,
      text: session.buffer.slice(-count),
      truncated: session.buffer.length > count,
    }
  }

  async close(id) {
    const session = this.sessions.get(id)
    if (session === undefined) return
    if (session.closing !== undefined) return session.closing
    session.status = 'closing'
    this.emitChange()
    session.closing = this.kill(session).finally(() => this.finish(session))
    return session.closing
  }

  async closeAll() {
    await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)))
  }

  require(id) {
    const session = this.sessions.get(id)
    if (session === undefined) throw coded('NO_SESSION', `terminal "${id}" does not exist`)
    return session
  }

  async kill(session) {
    const pid = session.pty.pid
    if (process.platform === 'win32' && Number.isInteger(pid) && pid > 0) {
      const taskkill = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\taskkill.exe`
      try { await execFileAsync(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }) } catch {}
      return
    }
    try { session.pty.kill('SIGTERM') } catch {}
    await new Promise(resolve => setTimeout(resolve, 300))
    try { session.pty.kill('SIGKILL') } catch {}
  }

  finish(session) {
    if (this.sessions.get(session.id) !== session) return
    session.dataDisposable?.dispose?.()
    session.exitDisposable?.dispose?.()
    this.sessions.delete(session.id)
    this.emitChange()
  }

  emitChange() {
    const list = this.list()
    for (const listener of this.listeners) {
      try { listener(list) } catch {}
    }
  }
}

export function managerFailure(error) {
  return { type: 'error', error: publicError(error) }
}

function coded(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
