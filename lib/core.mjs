import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

export const MAX_PROTOCOL_BYTES = 1024 * 1024
export const DEFAULT_MAX_TERMINALS = 8
export const DEFAULT_MAX_BUFFER_CHARS = 256 * 1024

const TYPES = new Set(['open', 'input', 'resize', 'close'])

export function normalizeConfig(input = {}) {
  const maxTerminals = integerBetween(input.maxTerminals, 1, 32, DEFAULT_MAX_TERMINALS)
  const maxBufferChars = integerBetween(input.maxBufferChars, 4096, 2 * 1024 * 1024, DEFAULT_MAX_BUFFER_CHARS)
  const brandUrl = typeof input.brandUrl === 'string' && /^https:\/\//.test(input.brandUrl)
    ? input.brandUrl
    : 'https://www.u-king.org/?from=dsh-workspace-terminal'
  const roots = Array.isArray(input.allowedRoots) && input.allowedRoots.length > 0
    ? input.allowedRoots
    : [process.cwd()]
  return {
    maxTerminals,
    maxBufferChars,
    brandUrl,
    allowedRoots: roots.map(root => path.resolve(String(root))),
    shell: typeof input.shell === 'string' && input.shell.trim() !== '' ? input.shell : defaultShell(),
    shellArgs: Array.isArray(input.shellArgs) ? input.shellArgs.map(String) : defaultShellArgs(),
    launchers: normalizeLaunchers(input.launchers),
  }
}

export function normalizeLaunchers(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : [
    { id: 'shell', label: process.platform === 'win32' ? 'PowerShell' : 'Shell', command: '' },
    { id: 'claude', label: 'Claude Code', command: 'claude' },
    { id: 'hermes', label: 'Hermes', command: 'hermes' },
    { id: 'codex', label: 'Codex', command: 'codex' },
  ]
  const ids = new Set()
  return source.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('launcher must be an object')
    const id = String(item.id ?? '')
    const label = String(item.label ?? '')
    const command = String(item.command ?? '')
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new TypeError(`invalid launcher id "${id}"`)
    if (ids.has(id)) throw new TypeError(`duplicate launcher id "${id}"`)
    if (label.trim() === '' || label.length > 48) throw new TypeError(`invalid label for launcher "${id}"`)
    if (/[\r\n\0]/.test(command) || command.length > 512) throw new TypeError(`invalid command for launcher "${id}"`)
    ids.add(id)
    return Object.freeze({ id, label, command })
  })
}

export function parseClientMessage(raw) {
  const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
  if (Buffer.byteLength(text) > MAX_PROTOCOL_BYTES) throw protocolError('MESSAGE_TOO_LARGE', 'terminal message is too large')
  let message
  try {
    message = JSON.parse(text)
  } catch {
    throw protocolError('INVALID_JSON', 'terminal message is not valid JSON')
  }
  if (typeof message !== 'object' || message === null || !TYPES.has(message.type)) {
    throw protocolError('INVALID_MESSAGE', 'terminal message has an unknown type')
  }
  if (message.type === 'open') {
    if (typeof message.launcherId !== 'string') throw protocolError('INVALID_OPEN', 'launcherId is required')
    return {
      type: 'open', launcherId: message.launcherId,
      cwd: typeof message.cwd === 'string' ? message.cwd : undefined,
      cols: terminalDimension(message.cols, 20, 400, 120),
      rows: terminalDimension(message.rows, 5, 200, 36),
    }
  }
  if (message.type === 'input') {
    if (typeof message.data !== 'string' || Buffer.byteLength(message.data) > 64 * 1024) {
      throw protocolError('INVALID_INPUT', 'terminal input must be a string no larger than 64 KiB')
    }
    return { type: 'input', data: message.data }
  }
  if (message.type === 'resize') {
    return {
      type: 'resize',
      cols: terminalDimension(message.cols, 20, 400, 120),
      rows: terminalDimension(message.rows, 5, 200, 36),
    }
  }
  return { type: 'close' }
}

export function resolveAllowedCwd(requested, roots) {
  const candidate = path.resolve(typeof requested === 'string' && requested.trim() !== '' ? requested : roots[0])
  const allowed = roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))
  if (!allowed) throw protocolError('CWD_DENIED', 'working directory is outside configured roots')
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw protocolError('CWD_UNAVAILABLE', 'working directory is not an existing directory')
  }
  return candidate
}

export function scrubbedEnvironment(extra = {}) {
  const result = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key) || key.startsWith('DSH_')) continue
    result[key] = value
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

export function validWebSocketOrigin(req) {
  const host = req.headers?.host
  const origin = req.headers?.origin
  if (typeof host !== 'string' || typeof origin !== 'string') return false
  return origin === `http://${host}` || origin === `https://${host}`
}

export function externalOpenCommand(url, platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new TypeError('external URL must use https')
  if (platform === 'win32') return { file: `${systemRoot}\\System32\\rundll32.exe`, args: ['url.dll,FileProtocolHandler', url] }
  if (platform === 'darwin') return { file: 'open', args: [url] }
  return { file: 'xdg-open', args: [url] }
}

export function appendBounded(buffer, chunk, limit) {
  const next = `${buffer}${chunk}`
  return next.length <= limit ? next : next.slice(next.length - limit)
}

export function publicError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'TERMINAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}

function protocolError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function integerBetween(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function terminalDimension(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function defaultShell() {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

function defaultShellArgs() {
  return process.platform === 'win32' ? ['-NoLogo', '-NoExit'] : ['-l']
}
