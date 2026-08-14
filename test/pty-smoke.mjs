import pty from 'node-pty'

const marker = `DSH_WORKSPACE_TERMINAL_PTY_OK_${process.pid}`
const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-l']
const child = pty.spawn(shell, args, {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color' },
  useConpty: process.platform === 'win32',
})

let output = ''
let finished = false
const timeout = setTimeout(() => finish(1), 10_000)
child.onData((data) => {
  output += data
  if (output.includes(marker)) {
    child.write('exit\r')
    finish(0)
  }
})
child.onExit(() => {
  if (!output.includes(marker)) finish(1)
})
child.write(process.platform === 'win32' ? `Write-Output '${marker}'\r` : `printf '${marker}\\n'\r`)

function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  if (code === 0) console.log('PTY_SMOKE_OK')
  else console.error(`PTY_SMOKE_FAILED\n${output}`)
  setTimeout(() => process.exit(code), 50)
}
