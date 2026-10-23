import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const suffix = randomBytes(6).toString('hex')
const network = `arche-ingress-test-${suffix}`
const proxy = `${network}-proxy`
const backend = `${network}-backend`
const directory = mkdtempSync(join(tmpdir(), 'arche-ingress-'))
const ingress = randomBytes(32).toString('hex')
const podman = (...args) => execFileSync('podman', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const containers = []
let createdNetwork = false
try {
  writeFileSync(join(directory, 'dynamic.json'), JSON.stringify({ http: {
    routers: { app: { rule: 'Host(`arche.test`) && !PathPrefix(`/api/internal`)', service: 'app', middlewares: ['ingress'] } },
    middlewares: { ingress: { headers: { customRequestHeaders: { 'X-Arche-Ingress': ingress } } } },
    services: { app: { loadBalancer: { servers: [{ url: `http://${backend}:3000` }] } } },
  } }))
  podman('network', 'create', network)
  createdNetwork = true
  podman('run', '-d', '--name', backend, '--network', network, '--entrypoint', 'node', 'arche-workspace:opencode-v2',
    '-e', "require('node:http').createServer((req,res)=>res.end(JSON.stringify(req.headers))).listen(3000)")
  containers.push(backend)
  podman('run', '-d', '--name', proxy, '--network', network, '--network-alias', 'arche.test', '-v', `${directory}:/config:ro`,
    'docker.io/library/traefik:v3.6.7@sha256:a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a',
    '--entrypoints.web.address=:80', '--providers.file.filename=/config/dynamic.json')
  containers.push(proxy)
  const output = podman('run', '--rm', '--network', network, '--entrypoint', 'node', 'arche-workspace:opencode-v2', '-e', `
    (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const headers = { host: 'arche.test', 'x-arche-ingress': 'forged', 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '1.1.1.1' };
          const response = await fetch('http://arche.test/api/health', { headers });
          if (!response.ok) throw Error('not ready: ' + response.status + ' ' + await response.text());
          const echoed = await response.json();
          const denied = [];
          for (const path of ['/api/internal/secrets', '/api/internal', '/api/%69nternal/secrets']) {
            denied.push((await fetch('http://arche.test' + path, { headers })).status);
          }
          console.log(JSON.stringify({ echoed, denied })); return;
        } catch (error) {
          if (attempt === 19) throw error;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    })().catch(error => { console.error(error); process.exit(1); });
  `)
  const { echoed, denied } = JSON.parse(output)
  assert.equal(echoed['x-arche-ingress'], ingress)
  assert.notEqual(echoed['x-forwarded-for'].split(',').at(-1).trim(), '1.1.1.1')
  assert.deepEqual(denied, [404, 404, 404])
  console.log('Traefik overwrites forged ingress credentials, records the actual peer and blocks internal routes.')
} catch (error) {
  for (const container of containers) console.error(podman('logs', container))
  throw error
} finally {
  for (const container of containers.reverse()) podman('rm', '-f', container)
  if (createdNetwork) podman('network', 'rm', network)
  rmSync(directory, { recursive: true, force: true })
}
