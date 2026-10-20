import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

const root = await mkdtemp(resolve('.v2-runtime-probe-'))
const directory = resolve(root, 'workspace')
const password = randomBytes(24).toString('hex')
const listener = createServer()
await new Promise((done) => listener.listen(0, '127.0.0.1', done))
const address = listener.address()
assert(address && typeof address === 'object')
const port = address.port
await new Promise((done) => listener.close(done))
await mkdir(directory)
await mkdir(resolve(directory, '.git'))
await mkdir(resolve(directory, 'nested'))
await mkdir(resolve(directory, 'ignored-dir'))
await mkdir(resolve(root, 'tmp'))
await writeFile(resolve(directory, 'opencode.json'), JSON.stringify({ update: 'disable', mcp: { servers: {} } }))
await writeFile(resolve(directory, 'hello.txt'), 'hello v2\n')
await writeFile(resolve(directory, '.gitignore'), 'ignored.txt\nignored-dir/\n')
await writeFile(resolve(directory, 'ignored.txt'), 'hidden\n')
await writeFile(resolve(directory, 'nested/child.txt'), 'nested\n')
await writeFile(resolve(directory, 'ignored-dir/child.txt'), 'hidden\n')
const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: directory,
  env: {
    PATH: process.env.PATH,
    HOME: root,
    TMPDIR: resolve(root, 'tmp'),
    XDG_CONFIG_HOME: resolve(root, 'config'),
    XDG_DATA_HOME: resolve(root, 'data'),
    XDG_CACHE_HOME: resolve(root, 'cache'),
    XDG_STATE_HOME: resolve(root, 'state'),
    OPENCODE_SERVER_PASSWORD: password,
  },
  stdio: 'ignore',
})
const baseUrl = `http://127.0.0.1:${port}`
const auth = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }
const client = OpenCode.make({ baseUrl, headers: auth })
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const info = await client.server.info({ signal: AbortSignal.timeout(1000) })
      assert.equal(info.version, '2.0.32')
      ready = true
      break
    } catch { await sleep(100) }
  }
  assert(ready, 'server readiness')
  assert.equal((await fetch(`${baseUrl}/api/info`)).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/info`, { headers: { Authorization: 'Basic invalid' } })).status, 401)
  const parent = await client.session.create({ title: 'parent', location: { directory } })
  const childSession = await client.session.create({ title: 'child', parentID: parent.id })
  const location = await client.location.get()
  assert.equal(location.directory, directory)
  const roots = await client.session.list({ directory, parentID: null, order: 'desc' })
  assert.deepEqual(roots.data.map((item) => item.id), [parent.id])
  assert.equal((await client.session.get({ sessionID: parent.id })).title, 'parent')
  const children = await client.session.list({ directory, parentID: parent.id, limit: 1 })
  assert.deepEqual(children.data.map((item) => item.id), [childSession.id])
  const end = await client.session.list({ directory, parentID: parent.id, cursor: children.cursor.next, limit: 1 })
  assert.equal(end.data.length, 0)
  assert.equal(end.cursor.next, null)
  await client.session.update({ sessionID: parent.id, title: 'renamed' })
  assert.equal((await client.session.get({ sessionID: parent.id })).title, 'renamed')
  assert.deepEqual(await client.session.active(), {})
  assert.equal((await client.session.interrupt({ sessionID: parent.id, resume: false })).interrupted, false)
  assert.deepEqual((await client.message.list({ sessionID: parent.id, order: 'asc' })).data, [])
  assert.deepEqual((await client.permission.request.list({ location: { directory } })).data, [])
  assert.deepEqual((await client.mcp.list({ location: { directory } })).data, [])
  assert((await client.agent.list({ location: { directory } })).data.length > 0)
  const listing = await client.file.list({ location: { directory }, path: directory })
  const found = await client.file.find({ location: { directory }, query: 'hlo', type: 'file', limit: 50 })
  const read = await client.file.read({ location: { directory }, path: resolve(directory, 'hello.txt') })
  const all = await client.file.find({ location: { directory }, query: '', limit: 10000 })
  const dirs = await client.file.find({ location: { directory }, query: '', type: 'directory', limit: 10000 })
  const nested = await client.file.list({ location: { directory }, path: resolve(directory, 'nested') })
  assert(!all.data.some((entry) => entry.path.includes('ignored')))
  assert(all.data.some((entry) => entry.path === 'nested/'))
  assert(found.data.some((entry) => entry.path === 'hello.txt'))
  assert.equal(new TextDecoder().decode(read), 'hello v2\n')
  console.log('FILES', JSON.stringify({ listing: listing.data, found: found.data, all: all.data, dirs: dirs.data, nested: nested.data, read: new TextDecoder().decode(read) }))
  await client.session.remove({ sessionID: parent.id })
  let missing
  try { await client.session.get({ sessionID: parent.id }) } catch (error) { missing = error }
  console.log('NOT_FOUND', JSON.stringify(missing))
  assert.equal(missing?._tag, 'SessionNotFoundError')
  console.log('PASS: matched client/runtime, auth, readiness, sessions, pagination, idle interrupt, empty messages/permissions/MCP, agents, files')
} finally {
  child.kill('SIGTERM')
  await new Promise((done) => child.once('exit', done))
  await rm(root, { recursive: true, force: true })
}
