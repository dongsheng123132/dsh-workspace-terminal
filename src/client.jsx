import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css'

const MANIFEST_PATH = '/plugins/dsh-workspace-terminal/manifest'
const SOCKET_PATH = '/plugins/dsh-workspace-terminal/ws'
const META_NAME = 'dsh-workspace-terminal-token'

const styles = `${xtermCss}
[data-uking-terminal-button]{font:inherit;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.uking-dock-toggle{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 9px;border-radius:8px!important}
.uking-dock-toggle:hover,.uking-dock-toggle[data-open=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.uking-dock{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;min-width:360px;max-width:calc(100% - 280px);background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-16px 0 40px rgba(0,0,0,.28);transform:translateX(102%);transition:transform .2s ease;pointer-events:none;overflow:hidden}
.uking-dock[data-open=true]{transform:translateX(0);pointer-events:auto}
.uking-resizer{position:absolute;left:-5px;top:0;bottom:0;width:10px;cursor:col-resize;z-index:2}
.uking-resizer:hover:after{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--dsw-alias-brand-primary)}
.uking-head{height:44px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.uking-brand{font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);white-space:nowrap}.uking-badge{font-size:10px;padding:2px 6px;border-radius:999px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.uking-launchers{display:flex;gap:5px;overflow:auto;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.uking-launch{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);height:28px;padding:0 9px;border-radius:7px;cursor:pointer;white-space:nowrap;font-size:12px}.uking-launch:hover{border-color:var(--dsw-alias-brand-primary)}
.uking-tabs{display:flex;min-height:34px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.uking-tab{display:flex;align-items:center;gap:6px;min-width:110px;max-width:180px;padding:0 8px;border-right:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}.uking-tab[data-active=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:inset 0 2px var(--dsw-alias-brand-primary)}
.uking-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.uking-tab button,.uking-close{border:0;background:transparent;color:inherit;cursor:pointer;border-radius:4px}.uking-tab button:hover,.uking-close:hover{background:var(--dsw-alias-bg-layer-3)}
.uking-body{position:relative;flex:1;min-height:0;background:#111315}.uking-terminal{position:absolute;inset:0;padding:6px}.uking-terminal[hidden]{display:none}.uking-terminal-host{width:100%;height:100%}
.uking-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;text-align:center;padding:30px;color:var(--dsw-alias-label-secondary)}.uking-empty strong{color:var(--dsw-alias-label-primary);font-size:15px}.uking-empty p{max-width:390px;margin:0;font-size:12px;line-height:1.65}
.uking-foot{min-height:34px;display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:10px;color:var(--dsw-alias-label-tertiary)}.uking-foot a{color:var(--dsw-alias-brand-primary);text-decoration:none}.uking-foot a:hover{text-decoration:underline}.uking-spacer{flex:1}.uking-cwd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%}
.uking-error{position:absolute;left:10px;right:10px;bottom:10px;padding:8px 10px;border-radius:8px;background:#4b1f24;color:#ffd9de;font-size:11px;z-index:4}
`

function ensureStyles() {
  if (document.querySelector('style[data-plugin-css="dsh-workspace-terminal"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-workspace-terminal'
  tag.dataset.pluginCss = 'dsh-workspace-terminal'
  tag.textContent = styles
  document.head.appendChild(tag)
}

function createDockStore() {
  let value = false
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    toggle: () => { value = !value; for (const listener of listeners) listener() },
    close: () => { if (!value) return; value = false; for (const listener of listeners) listener() },
  }
}

function useDock(store) { return useSyncExternalStore(store.subscribe, store.getSnapshot) }

function ToggleButton({ store, wide = true }) {
  const open = useDock(store)
  return <button data-uking-terminal-button className="uking-dock-toggle" data-open={open} onClick={store.toggle} title="U-King 多 Agent 终端">
    <span aria-hidden="true">▣</span>{wide && <span>终端</span>}
  </button>
}

function TerminalPane({ tab, active, cwd, onReady }) {
  const host = useRef(null)
  const terminal = useRef(null)
  const fit = useRef(null)
  const socket = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = document.querySelector(`meta[name="${META_NAME}"]`)?.getAttribute('content')
    if (!token) { setError('DSH 页面缺少终端能力令牌，请刷新页面。'); return }
    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 10000,
      fontSize: 13,
      fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
      theme: { background: '#111315', foreground: '#e7e9ec', cursor: '#7aa2ff', selectionBackground: '#34558a88' },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(host.current)
    terminal.current = term
    fit.current = fitAddon
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}${SOCKET_PATH}?token=${encodeURIComponent(token)}`)
    socket.current = ws
    ws.addEventListener('open', () => {
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'open', launcherId: tab.launcher.id, cwd, cols: term.cols, rows: term.rows }))
    })
    ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.type === 'data') term.write(message.data)
      if (message.type === 'ready') onReady(tab.id, message.session)
      if (message.type === 'error') setError(`${message.error.code}: ${message.error.message}`)
      if (message.type === 'exit') term.write(`\r\n\x1b[90m[进程已退出: ${message.exitCode ?? message.signal ?? 'unknown'}]\x1b[0m\r\n`)
    })
    ws.addEventListener('close', () => { socket.current = null })
    const input = term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data })) })
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent === null) return
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      input.dispose()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close' }))
      ws.close()
      term.dispose()
    }
  }, [])

  useEffect(() => { if (active) requestAnimationFrame(() => { fit.current?.fit(); terminal.current?.focus() }) }, [active])
  return <div className="uking-terminal" hidden={!active}><div ref={host} className="uking-terminal-host" />{error && <div className="uking-error">{error}</div>}</div>
}

function AgentDock({ store, useSessions }) {
  const open = useDock(store)
  const current = useSessions(state => state.current === undefined ? undefined : state.byId[state.current])
  const [manifest, setManifest] = useState(null)
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [width, setWidth] = useState(560)
  const sequence = useRef(0)

  useEffect(() => { fetch(MANIFEST_PATH, { cache: 'no-store' }).then(r => r.json()).then(setManifest).catch(() => {}) }, [])
  const cwd = current?.cwd || manifest?.cwd || ''
  const openTab = (launcher) => {
    const id = `tab-${++sequence.current}`
    setTabs(items => [...items, { id, launcher, session: null }])
    setActiveId(id)
  }
  const closeTab = (id) => {
    setTabs(items => {
      const next = items.filter(item => item.id !== id)
      if (activeId === id) setActiveId(next.at(-1)?.id ?? null)
      return next
    })
  }
  const onReady = (id, session) => setTabs(items => items.map(item => item.id === id ? { ...item, session } : item))
  const beginResize = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = e => setWidth(Math.max(360, Math.min(window.innerWidth - 280, startWidth + startX - e.clientX)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <aside className="uking-dock" data-open={open} style={{ width }} aria-label="U-King 多 Agent 终端">
    <div className="uking-resizer" onPointerDown={beginResize} />
    <div className="uking-head"><span className="uking-brand">U-King Agent Dock</span><span className="uking-badge">DSH 协同</span><span className="uking-spacer" /><button className="uking-close" onClick={store.close} title="收起">✕</button></div>
    <div className="uking-launchers">{manifest?.launchers?.map(launcher => <button key={launcher.id} className="uking-launch" onClick={() => openTab(launcher)}>＋ {launcher.label}</button>) ?? <span>正在加载终端…</span>}</div>
    {tabs.length > 0 && <div className="uking-tabs">{tabs.map(tab => <div key={tab.id} className="uking-tab" data-active={tab.id === activeId} onClick={() => setActiveId(tab.id)}><span>● {tab.launcher.label}</span><button onClick={e => { e.stopPropagation(); closeTab(tab.id) }}>×</button></div>)}</div>}
    <div className="uking-body">{tabs.length === 0 ? <div className="uking-empty"><strong>右侧多 Agent 工作台</strong><p>打开 Claude Code、Hermes、Codex 或普通 Shell。每个标签都是独立真实 PTY；收起继续运行，关闭标签才停止。</p><p>DSH 可通过 <code>uking_terminal_*</code> 工具读取和发送，实现同一工作目录里的接力协作。</p></div> : tabs.map(tab => <TerminalPane key={tab.id} tab={tab} active={tab.id === activeId} cwd={cwd} onReady={onReady} />)}</div>
    <div className="uking-foot"><span className="uking-cwd" title={cwd}>目录：{cwd || '等待工作区'}</span><span className="uking-spacer" /><span>换模型后请新开终端</span><a href={manifest?.brand?.url || 'https://www.u-king.org/?from=dsh-workspace-terminal'} target="_blank" rel="noreferrer">用 U-King 管理模型与更多 AI →</a></div>
  </aside>
}

export const inject = ['slots', 'sessions']

export function apply(ctx) {
  ensureStyles()
  const store = createDockStore()
  const buttonInject = () => ({ store })
  function HeaderAction(props) { return <ToggleButton store={props.store} wide /> }
  function SidebarAction(props) { return <ToggleButton store={props.store} wide={props.wide} /> }
  function Dock(props) { return <AgentDock store={store} useSessions={props.useSessions} /> }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'uking-agent-dock', order: 40 }, Dock))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'uking-terminal', order: 60, inject: buttonInject }, HeaderAction))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'uking-terminal', order: 20, inject: buttonInject }, SidebarAction))
}
