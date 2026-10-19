// Starts `dsh web` the way DSH Desktop starts its Harness: the Electron app running
// as node, detached and with windowsHide, so neither it nor the sandbox runner it
// launches has a console. Output is forwarded here.
//   node --env-file=<env> dev/electron-web.mjs <electron.exe> <dsh bin.js> [port]

import { spawn } from 'node:child_process'

const [electron, bin, port = '3082'] = process.argv.slice(2)
if (!electron || !bin) {
  console.error('usage: node dev/electron-web.mjs <electron.exe> <dsh bin.js> [port]')
  process.exit(2)
}
const child = spawn(electron, [bin, 'web', '--no-open', '--port', port], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  detached: true,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.on('exit', (code, signal) => {
  console.log(`dsh exited (${signal ?? code})`)
  process.exit(code ?? 1)
})
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => child.kill())
