import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  appendBounded, normalizeConfig, normalizeLaunchers, parseClientMessage,
  resolveAllowedCwd, scrubbedEnvironment, validWebSocketOrigin,
} from '../lib/core.mjs'

test('normalizes the built-in launcher roster', () => {
  assert.deepEqual(normalizeConfig().launchers.map(item => item.id), ['shell', 'claude', 'hermes', 'codex'])
})

test('rejects duplicate launcher ids', () => {
  assert.throws(() => normalizeLaunchers([{ id: 'x', label: 'X', command: '' }, { id: 'x', label: 'Y', command: '' }]), /duplicate/)
})

test('rejects launcher command line breaks', () => {
  assert.throws(() => normalizeLaunchers([{ id: 'x', label: 'X', command: 'ok\nwhoami' }]), /invalid command/)
})

test('parses bounded open and resize messages', () => {
  assert.deepEqual(parseClientMessage('{"type":"resize","cols":120,"rows":30}'), { type: 'resize', cols: 120, rows: 30 })
  assert.equal(parseClientMessage('{"type":"open","launcherId":"claude"}').cols, 120)
})

test('rejects unknown protocol messages', () => {
  assert.throws(() => parseClientMessage('{"type":"exec","command":"whoami"}'), error => error.code === 'INVALID_MESSAGE')
})

test('caps terminal input messages', () => {
  assert.throws(() => parseClientMessage(JSON.stringify({ type: 'input', data: 'x'.repeat(70_000) })), error => error.code === 'INVALID_INPUT')
})

test('allows cwd only at or below configured roots', () => {
  const root = process.cwd()
  assert.equal(resolveAllowedCwd(root, [root]), path.resolve(root))
  assert.throws(() => resolveAllowedCwd(path.dirname(root), [root]), error => error.code === 'CWD_DENIED')
})

test('scrubs credential-shaped and DSH ambient names', () => {
  const beforeSecret = process.env.PROBE_SECRET
  const beforeDsh = process.env.DSH_PROBE
  process.env.PROBE_SECRET = 'hidden'
  process.env.DSH_PROBE = 'hidden'
  try {
    const env = scrubbedEnvironment({ TERM: 'xterm-256color' })
    assert.equal(env.PROBE_SECRET, undefined)
    assert.equal(env.DSH_PROBE, undefined)
    assert.equal(env.TERM, 'xterm-256color')
  } finally {
    if (beforeSecret === undefined) delete process.env.PROBE_SECRET
    else process.env.PROBE_SECRET = beforeSecret
    if (beforeDsh === undefined) delete process.env.DSH_PROBE
    else process.env.DSH_PROBE = beforeDsh
  }
})

test('origin must match the actual Host header', () => {
  assert.equal(validWebSocketOrigin({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(validWebSocketOrigin({ headers: { host: '127.0.0.1:3080', origin: 'https://evil.example' } }), false)
})

test('bounded append retains the newest tail', () => {
  assert.equal(appendBounded('1234', '5678', 5), '45678')
})
