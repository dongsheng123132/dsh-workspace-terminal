import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WebSocketServer } from 'ws'
import { externalOpenCommand, normalizeConfig, parseClientMessage, publicError, validWebSocketOrigin } from './lib/core.mjs'
import { TerminalManager, managerFailure } from './lib/terminal-manager.mjs'

export const name = 'dsh-workspace-terminal'
export const inject = ['webServer', 'tools']

const MANIFEST_PATH = '/plugins/dsh-workspace-terminal/manifest'
const SOCKET_PATH = '/plugins/dsh-workspace-terminal/ws'
const BRAND_PATH = '/plugins/dsh-workspace-terminal/uking'
const BRAND_OPEN_PATH = '/plugins/dsh-workspace-terminal/open-uking'
const META_NAME = 'dsh-workspace-terminal-token'
const execFileAsync = promisify(execFile)

function send(socket, value) {
  if (socket.readyState === 1) socket.send(JSON.stringify(value))
}

function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function terminalTools(manager) {
  return [
    defineTool({
      name: 'uking_terminal_list',
      description: 'List the live U-King terminal tabs opened in the DSH right-side dock. Returns metadata only, not terminal output.',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderJson },
      async execute() { return { terminals: manager.list() } },
    }),
    defineTool({
      name: 'uking_terminal_read',
      description: 'Read a bounded tail from one user-opened U-King terminal tab so DSH can coordinate with Claude Code, Hermes, or Codex. Use only when the user asks to collaborate with that terminal.',
      parameters: {
        terminalId: { type: 'string', required: true, description: 'Exact id returned by uking_terminal_list.' },
        tailChars: { type: 'number', description: 'Tail length, capped at 12000 characters.' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) { return manager.read(args.terminalId, args.tailChars) },
    }),
    defineTool({
      name: 'uking_terminal_send',
      description: 'Send text to one user-opened U-King terminal tab. This controls a real local CLI; use only after the user explicitly asks DSH to hand work to that terminal.',
      parameters: {
        terminalId: { type: 'string', required: true, description: 'Exact id returned by uking_terminal_list.' },
        text: { type: 'string', required: true, description: 'Text to type. Limited to 8000 characters.' },
        submit: { type: 'boolean', description: 'Append Enter after the text; defaults to true.' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        if (args.text.length > 8000) throw Object.assign(new Error('text exceeds 8000 characters'), { code: 'INPUT_TOO_LARGE' })
        manager.write(args.terminalId, `${args.text}${args.submit === false ? '' : '\r'}`)
        return { sent: true, terminalId: args.terminalId, submitted: args.submit !== false }
      },
    }),
  ]
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const token = randomBytes(32).toString('base64url')
  const manager = new TerminalManager(config)
  const wss = new WebSocketServer({ noServer: true, clientTracking: true })

  for (const definition of terminalTools(manager)) ctx.tools.register(definition)

  const disposeIndex = ctx.webServer.tapIndex((html) => html.replace(
    /<head([^>]*)>/i,
    `<head$1><meta name="${META_NAME}" content="${token}">`,
  ))
  const disposeManifest = ctx.webServer.register({
    kind: 'exact',
    path: MANIFEST_PATH,
    handler(req, res) {
      if (req.method !== 'GET') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } })
      return json(res, 200, {
        launchers: config.launchers.map(({ id, label }) => ({ id, label })),
        cwd: config.allowedRoots[0],
        maxTerminals: config.maxTerminals,
        brand: { name: 'U-King', url: config.brandUrl, href: BRAND_PATH, openPath: BRAND_OPEN_PATH },
        collaborationTools: ['uking_terminal_list', 'uking_terminal_read', 'uking_terminal_send'],
      })
    },
  })
  const disposeBrand = ctx.webServer.register({
    kind: 'exact',
    path: BRAND_PATH,
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } })
      res.writeHead(302, {
        location: config.brandUrl,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      res.end()
    },
  })
  const disposeBrandOpen = ctx.webServer.register({
    kind: 'exact',
    path: BRAND_OPEN_PATH,
    async handler(req, res) {
      if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } })
      if (!validWebSocketOrigin(req) || !equalToken(req.headers['x-uking-terminal-token'], token)) {
        return json(res, 403, { error: { code: 'FORBIDDEN' } })
      }
      try {
        const command = externalOpenCommand(config.brandUrl)
        await execFileAsync(command.file, command.args, { windowsHide: true, timeout: 10000 })
        return json(res, 200, { opened: true, url: config.brandUrl })
      } catch (error) {
        ctx.logger.warn('failed to open U-King URL', error)
        return json(res, 500, { error: { code: 'OPEN_FAILED', message: 'Could not open the system browser.' } })
      }
    },
  })
  const disposeUpgrade = ctx.webServer.registerUpgrade({
    path: SOCKET_PATH,
    handler(req, socket, head) {
      const url = new URL(req.url ?? SOCKET_PATH, 'http://local')
      if (!validWebSocketOrigin(req) || !equalToken(url.searchParams.get('token'), token)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req) })
    },
  })

  wss.on('connection', (socket) => {
    let terminalId
    let chain = Promise.resolve()
    const sink = value => send(socket, value)
    socket.on('message', (raw) => {
      chain = chain.then(async () => {
        let message
        try { message = parseClientMessage(raw) } catch (error) { send(socket, managerFailure(error)); return }
        try {
          if (message.type === 'open') {
            if (terminalId !== undefined) throw Object.assign(new Error('this connection already owns a terminal'), { code: 'ALREADY_OPEN' })
            terminalId = manager.open(message, sink)
          } else if (message.type === 'input') {
            if (terminalId === undefined) throw Object.assign(new Error('open a terminal first'), { code: 'NOT_OPEN' })
            manager.write(terminalId, message.data)
          } else if (message.type === 'resize') {
            if (terminalId !== undefined) manager.resize(terminalId, message.cols, message.rows)
          } else if (terminalId !== undefined) {
            const id = terminalId
            terminalId = undefined
            await manager.close(id)
          }
        } catch (error) {
          send(socket, { type: 'error', error: publicError(error) })
        }
      }).catch((error) => { send(socket, { type: 'error', error: publicError(error) }) })
    })
    socket.on('close', () => {
      if (terminalId !== undefined) void manager.close(terminalId)
    })
  })

  ctx.effect(() => async () => {
    disposeUpgrade()
    disposeBrandOpen()
    disposeBrand()
    disposeManifest()
    disposeIndex()
    for (const socket of wss.clients) socket.close(1001, 'plugin disposed')
    await manager.closeAll()
    await new Promise(resolve => wss.close(() => resolve()))
  }, 'dsh-workspace-terminal cleanup')
}
