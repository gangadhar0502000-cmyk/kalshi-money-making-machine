/**
 * Start read-only Kalshi proxy + Vite for near-real paper MM.
 * Usage: npm run dev:real
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(root, '..')
const port = process.env.MM_PROXY_PORT || '8787'

const kids = []

function run(cmd, args, name) {
  const child = spawn(cmd, args, {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, MM_PROXY_PORT: port },
    shell: false,
  })
  child.on('exit', (code, signal) => {
    console.log(`[dev:real] ${name} exited code=${code} signal=${signal}`)
    for (const k of kids) {
      if (k !== child && !k.killed) k.kill('SIGTERM')
    }
    process.exit(code ?? 1)
  })
  kids.push(child)
  return child
}

run(process.execPath, [path.join(root, 'mm-proxy.mjs')], 'mm-proxy')
run(path.join(repo, 'node_modules/.bin/vite'), [], 'vite')

function shutdown() {
  for (const k of kids) {
    if (!k.killed) k.kill('SIGTERM')
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
