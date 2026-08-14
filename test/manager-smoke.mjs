import { normalizeConfig } from '../lib/core.mjs'
import { TerminalManager } from '../lib/terminal-manager.mjs'

const marker = `DSH_WORKSPACE_TERMINAL_MANAGER_OK_${process.pid}`
const config = normalizeConfig({
  maxTerminals: 2,
  shellArgs: process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-l'],
})
const manager = new TerminalManager(config)
let output = ''
let finished = false
const id = manager.open({ launcherId: 'shell', cwd: process.cwd(), cols: 100, rows: 30 }, (message) => {
  if (message.type !== 'data') return
  output += message.data
  if (output.includes(marker)) finish(0)
})

manager.write(id, process.platform === 'win32' ? `Write-Output '${marker}'\r` : `printf '${marker}\\n'\r`)
setTimeout(() => finish(1), 10_000)

async function finish(code) {
  if (finished) return
  finished = true
  if (code === 0) console.log('MANAGER_SMOKE_OK')
  else console.error(`MANAGER_SMOKE_FAILED\n${output}`)
  await manager.closeAll()
  setTimeout(() => process.exit(code), 50)
}
