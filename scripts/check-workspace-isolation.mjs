import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const suffix = randomBytes(6).toString('hex')
const control = `arche-security-control-${suffix}`
const workspace = `arche-security-workspace-${suffix}`
const server = `arche-security-proxy-${suffix}`
const image = 'arche-workspace:opencode-v2'
const networks = []
let createdServer = false
const podman = (...args) => execFileSync('podman', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
try {
  podman('network', 'create', '--internal', control)
  networks.push(control)
  podman('network', 'create', workspace)
  networks.push(workspace)
  podman('run', '-d', '--name', server, '--network', control, '--entrypoint', 'node', image,
    '-e', "require('node:http').createServer((req,res)=>res.end('control')).listen(2375,'0.0.0.0')")
  createdServer = true
  const info = JSON.parse(podman('inspect', server))[0]
  const address = info.NetworkSettings.Networks[control].IPAddress
  const client = (network, source) => podman('run', '--rm', '--network', network, '--entrypoint', 'node', image, '-e', source)
  assert.equal(client(control, `fetch('http://${address}:2375',{signal:AbortSignal.timeout(5000)}).then(r=>r.text()).then(console.log).catch(()=>process.exit(1))`), 'control')
  assert.equal(client(workspace, `fetch('http://${address}:2375',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1)).catch(()=>console.log('isolated'))`), 'isolated')
  console.log('Control client can connect; workspace cannot reach the control service even by IP.')
} finally {
  if (createdServer) podman('rm', '-f', server)
  for (const network of networks.reverse()) podman('network', 'rm', network)
}
