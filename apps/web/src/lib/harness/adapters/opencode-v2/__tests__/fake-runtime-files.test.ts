import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { listWorkspaceFiles } from '@/lib/harness/adapters/opencode-v2/workspace-files'

const RUNTIME_CREDENTIAL = 'fake'
const connection = vi.hoisted(() => ({ baseUrl: '', authHeader: `Basic ${Buffer.from('opencode:fake').toString('base64')}` }))
vi.mock('@/lib/harness/runtime-connection', () => ({
  getInstanceBasicAuth: async () => connection,
  getInstanceUrl: () => connection.baseUrl,
}))

const FAKE_RUNTIME = resolve(__dirname, '../../../../../../../../scripts/e2e/fake-runtime-server.mjs')

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('no port')))
    })
  })
}

// The web E2E smoke drives the V2 adapter against this fake, so it must
// answer every filesystem route the adapter calls through the real SDK.
describe('V2 workspace files against the E2E fake runtime', () => {
  let runtime: ChildProcess

  beforeAll(async () => {
    connection.baseUrl = `http://127.0.0.1:${await freePort()}`
    runtime = spawn(process.execPath, [FAKE_RUNTIME], {
      env: { ...process.env, ARCHE_E2E_RUNTIME_BASE_URL: connection.baseUrl, ARCHE_E2E_RUNTIME_PASSWORD: RUNTIME_CREDENTIAL },
      stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fetch(`${connection.baseUrl}/__e2e/health`).then((response) => response.ok, () => false)) break
      await new Promise((wait) => setTimeout(wait, 50))
    }
    for (const path of ['docs/plan.md', 'docs/notes/research.md', 'readme.md']) {
      const upload = await fetch(`${connection.baseUrl}/files/upload?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { Authorization: connection.authHeader, 'Content-Type': 'text/markdown' },
        body: `# ${path}\n`,
      })
      expect(upload.ok).toBe(true)
    }
  })

  afterAll(() => {
    runtime?.kill()
  })

  it('lists the root and nested directories one level at a time', async () => {
    expect(await listWorkspaceFiles('fake-runtime-files')).toEqual({ ok: true, data: [
      { id: 'docs', name: 'docs', path: 'docs', type: 'directory' },
      { id: 'readme.md', name: 'readme.md', path: 'readme.md', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('fake-runtime-files', 'docs')).toEqual({ ok: true, data: [
      { id: 'docs/notes', name: 'notes', path: 'docs/notes', type: 'directory' },
      { id: 'docs/plan.md', name: 'plan.md', path: 'docs/plan.md', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('fake-runtime-files', 'docs/notes')).toEqual({ ok: true, data: [
      { id: 'docs/notes/research.md', name: 'research.md', path: 'docs/notes/research.md', type: 'file' },
    ] })
  })
})
