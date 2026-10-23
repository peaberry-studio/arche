import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { mcpTool } from './mcp-client.js'

const scratchDir = mcpTool('scratch_dir')
const scratchPublish = mcpTool('scratch_publish')

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arche-scratch-test-'))
  const previous = { scratch: process.env.ARCHE_SCRATCH_DIR, workspace: process.env.WORKSPACE_DIR }
  process.env.ARCHE_SCRATCH_DIR = path.join(root, 'scratch')
  process.env.WORKSPACE_DIR = path.join(root, 'workspace')
  await fs.mkdir(process.env.WORKSPACE_DIR, { recursive: true })
  t.after(async () => {
    for (const [name, value] of [['ARCHE_SCRATCH_DIR', previous.scratch], ['WORKSPACE_DIR', previous.workspace]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, scratch: process.env.ARCHE_SCRATCH_DIR, attachments: path.join(process.env.WORKSPACE_DIR, '.arche', 'attachments') }
}

const session = (sessionID) => ({ sessionID })

test('scratch_dir creates the session folder and prunes stale ones', async (t) => {
  const { scratch } = await setup(t)
  await fs.mkdir(path.join(scratch, 'ses_old'), { recursive: true })
  await fs.mkdir(path.join(scratch, 'ses_recent'), { recursive: true })
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await fs.utimes(path.join(scratch, 'ses_old'), old, old)

  const output = JSON.parse(await scratchDir.execute({}, session('ses_current')))

  assert.deepEqual(output, { ok: true, path: path.join(scratch, 'ses_current'), retentionHours: 24 })
  assert.equal((await fs.stat(output.path)).isDirectory(), true)
  assert.deepEqual((await fs.readdir(scratch)).sort(), ['ses_current', 'ses_recent'])
})

for (const tool of ['dir', 'publish']) {
  test(`scratch_${tool} refreshes an old session before another session prunes`, async (t) => {
    const { scratch } = await setup(t)
    const activeDir = path.join(scratch, 'ses_active')
    const marker = path.join(activeDir, '.last-used')
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await fs.mkdir(path.join(activeDir, 'out'), { recursive: true })
    await fs.writeFile(marker, '')
    await fs.utimes(marker, old, old)
    await fs.utimes(activeDir, old, old)
    await fs.writeFile(path.join(activeDir, 'out', 'report.txt'), 'keep me')

    const output = JSON.parse(await (tool === 'dir'
      ? scratchDir.execute({}, session('ses_active'))
      : scratchPublish.execute({ path: 'out/report.txt' }, session('ses_active'))))
    assert.equal(output.ok, true)
    assert.equal(await fs.readFile(path.join(activeDir, 'out', 'report.txt'), 'utf8'), 'keep me')

    const staleDir = path.join(scratch, 'ses_stale')
    await fs.mkdir(staleDir)
    await fs.utimes(staleDir, old, old)
    assert.equal(JSON.parse(await scratchDir.execute({}, session('ses_other'))).ok, true)

    assert.equal(await fs.readFile(path.join(activeDir, 'out', 'report.txt'), 'utf8'), 'keep me')
    assert.ok((await fs.stat(marker)).mtimeMs > old.getTime())
    await assert.rejects(fs.stat(staleDir), { code: 'ENOENT' })
  })
}

test('scratch pruning keeps a session whose files changed recently even if its marker is old', async (t) => {
  const { scratch } = await setup(t)
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const activeDir = path.join(scratch, 'ses_native')
  await fs.mkdir(path.join(activeDir, 'out', 'deep'), { recursive: true })
  await fs.writeFile(path.join(activeDir, '.last-used'), '')
  await fs.writeFile(path.join(activeDir, 'out', 'deep', 'draft.md'), 'edited by a native tool')
  for (const target of [path.join(activeDir, '.last-used'), path.join(activeDir, 'out', 'deep'), path.join(activeDir, 'out'), activeDir]) {
    await fs.utimes(target, old, old)
  }
  const staleDir = path.join(scratch, 'ses_untouched')
  await fs.mkdir(path.join(staleDir, 'out'), { recursive: true })
  await fs.writeFile(path.join(staleDir, 'out', 'old.md'), 'old')
  for (const target of [path.join(staleDir, 'out', 'old.md'), path.join(staleDir, 'out'), staleDir]) {
    await fs.utimes(target, old, old)
  }

  assert.equal(JSON.parse(await scratchDir.execute({}, session('ses_other'))).ok, true)

  assert.equal(await fs.readFile(path.join(activeDir, 'out', 'deep', 'draft.md'), 'utf8'), 'edited by a native tool')
  await assert.rejects(fs.stat(staleDir), { code: 'ENOENT' })
})

test('scratch pruning expires the last-used marker even when the directory mtime is recent', async (t) => {
  const { scratch } = await setup(t)
  const staleDir = path.join(scratch, 'ses_stale')
  await scratchDir.execute({}, session('ses_stale'))
  const marker = path.join(staleDir, '.last-used')
  await fs.writeFile(marker, '')
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await fs.utimes(marker, old, old)

  await scratchDir.execute({}, session('ses_other'))

  await assert.rejects(fs.stat(staleDir), { code: 'ENOENT' })
})

for (const tool of ['dir', 'publish']) {
  for (const link of ['symlink', 'link']) {
    test(`scratch_${tool} replaces a ${link} marker without modifying its target`, async (t) => {
      const { root, scratch } = await setup(t)
      const activeDir = path.join(scratch, 'ses_active')
      const sentinel = path.join(root, 'sentinel.txt')
      const marker = path.join(activeDir, '.last-used')
      await fs.mkdir(activeDir, { recursive: true })
      await fs.writeFile(path.join(activeDir, 'report.txt'), 'keep me')
      await fs.writeFile(sentinel, 'untouched')
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
      await fs.utimes(sentinel, old, old)
      await fs[link](sentinel, marker)
      await fs.utimes(activeDir, old, old)

      const output = JSON.parse(await (tool === 'dir'
        ? scratchDir.execute({}, session('ses_active'))
        : scratchPublish.execute({ path: 'report.txt' }, session('ses_active'))))

      assert.equal(output.ok, true)
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'untouched')
      assert.equal((await fs.lstat(marker)).isFile(), true)
      await scratchDir.execute({}, session('ses_other'))
      assert.equal(await fs.readFile(path.join(activeDir, 'report.txt'), 'utf8'), 'keep me')
    })
  }
}

test('scratch tools require a well-formed session id', async (t) => {
  await setup(t)
  assert.deepEqual(JSON.parse(await scratchDir.execute({})), { ok: false, error: 'caller_identity_unavailable' })
  assert.deepEqual(JSON.parse(await scratchDir.execute({}, session('../escape'))), { ok: false, error: 'caller_identity_unavailable' })
  assert.deepEqual(JSON.parse(await scratchPublish.execute({ path: 'a.txt' })), { ok: false, error: 'caller_identity_unavailable' })
})

test('scratch_publish copies a scratch file into attachments with a unique, sanitized name', async (t) => {
  const { scratch, attachments } = await setup(t)
  await fs.mkdir(path.join(scratch, 'ses_1', 'out'), { recursive: true })
  await fs.writeFile(path.join(scratch, 'ses_1', 'out', 'report.csv'), 'a,b\n1,2\n')

  const first = JSON.parse(await scratchPublish.execute({ path: 'out/report.csv' }, session('ses_1')))
  const second = JSON.parse(await scratchPublish.execute({ path: path.join(scratch, 'ses_1', 'out', 'report.csv') }, session('ses_1')))
  const renamed = JSON.parse(await scratchPublish.execute({ path: 'out/report.csv', name: 'Q3 résumé.csv' }, session('ses_1')))

  assert.deepEqual(first, { ok: true, attachment: { path: '.arche/attachments/report.csv', name: 'report.csv', size: 8 } })
  assert.equal(second.attachment.name, 'report (1).csv')
  assert.equal(renamed.attachment.name, 'Q3-r_sum_.csv')
  assert.equal(await fs.readFile(path.join(attachments, 'report (1).csv'), 'utf8'), 'a,b\n1,2\n')
  assert.equal(await fs.readFile(path.join(scratch, 'ses_1', 'out', 'report.csv'), 'utf8'), 'a,b\n1,2\n')
})

test('scratch_publish only reads regular files inside the caller session folder', async (t) => {
  const { root, scratch } = await setup(t)
  await fs.mkdir(path.join(scratch, 'ses_1', 'folder'), { recursive: true })
  await fs.mkdir(path.join(scratch, 'ses_2'), { recursive: true })
  await fs.writeFile(path.join(scratch, 'ses_2', 'other.txt'), 'other session')
  await fs.writeFile(path.join(root, 'outside.txt'), 'outside')
  await fs.symlink(path.join(root, 'outside.txt'), path.join(scratch, 'ses_1', 'link.txt'))

  const publish = async (target) => JSON.parse(await scratchPublish.execute({ path: target }, session('ses_1')))
  assert.deepEqual(await publish('../ses_2/other.txt'), { ok: false, error: 'path_outside_scratch' })
  assert.deepEqual(await publish(path.join(root, 'outside.txt')), { ok: false, error: 'path_outside_scratch' })
  assert.deepEqual(await publish('link.txt'), { ok: false, error: 'path_outside_scratch' })
  assert.deepEqual(await publish('missing.txt'), { ok: false, error: 'path_outside_scratch' })
  assert.deepEqual(await publish('folder'), { ok: false, error: 'not_a_file' })
})

test('scratch_publish refuses files over the attachment limit', async (t) => {
  const { scratch } = await setup(t)
  await fs.mkdir(path.join(scratch, 'ses_1'), { recursive: true })
  await fs.truncate(await fs.open(path.join(scratch, 'ses_1', 'big.bin'), 'w').then(async (handle) => { await handle.close(); return path.join(scratch, 'ses_1', 'big.bin') }), 25 * 1024 * 1024 + 1)

  const output = JSON.parse(await scratchPublish.execute({ path: 'big.bin' }, session('ses_1')))
  assert.deepEqual(output, { ok: false, error: 'file_too_large', maxBytes: 25 * 1024 * 1024 })
})

test('scratch tools describe the sandbox and publishing', () => {
  assert.match(scratchDir.description, /outside the Knowledge Base/)
  assert.match(scratchDir.description, /without asking/)
  assert.match(scratchDir.description, /24 hours/)
  assert.match(scratchPublish.description, /attachments/)
})

test('scratch tools take the session from harness metadata and reject a conflicting explicit id', async (t) => {
  const { scratch } = await setup(t)
  const { client } = await import('./mcp-client.js')
  const viaMetadata = await client.callTool({ name: 'scratch_dir', arguments: {}, _meta: { 'ai.opencode/sessionID': 'ses_meta' } })
  assert.equal(viaMetadata.structuredContent.path, path.join(scratch, 'ses_meta'))
  const conflicting = await client.callTool({ name: 'scratch_dir', arguments: { caller_session_id: 'ses_other' }, _meta: { 'ai.opencode/sessionID': 'ses_meta' } })
  assert.deepEqual(conflicting.structuredContent, { ok: false, error: 'caller_identity_unavailable' })
})

test('scratch tools reject agent-supplied session identities without harness metadata', async (t) => {
  const { scratch } = await setup(t)
  const { client } = await import('./mcp-client.js')
  const victim = path.join(scratch, 'ses_victim')
  await fs.mkdir(victim, { recursive: true })
  await fs.writeFile(path.join(victim, 'private.txt'), 'private')

  for (const name of ['scratch_dir', 'scratch_publish']) {
    for (const identity of [
      { caller_session_id: 'ses_victim' },
      { _meta: { 'ai.opencode/sessionID': 'ses_victim' } },
    ]) {
      const result = await client.callTool({ name, arguments: { path: 'private.txt', ...identity } })
      assert.deepEqual(result.structuredContent, { ok: false, error: 'caller_identity_unavailable' })
    }
  }
  assert.deepEqual(await fs.readdir(victim), ['private.txt'])
})

test('scratch_publish cannot read another session with trusted caller metadata', async (t) => {
  const { scratch, attachments } = await setup(t)
  const { client } = await import('./mcp-client.js')
  await fs.mkdir(path.join(scratch, 'ses_victim'), { recursive: true })
  await fs.writeFile(path.join(scratch, 'ses_victim', 'private.txt'), 'private')
  const _meta = { 'ai.opencode/sessionID': 'ses_caller' }

  const own = await client.callTool({ name: 'scratch_dir', arguments: {}, _meta })
  assert.equal(own.structuredContent.path, path.join(scratch, 'ses_caller'))
  const forged = await client.callTool({ name: 'scratch_publish', arguments: { path: 'private.txt', caller_session_id: 'ses_victim' }, _meta })
  assert.deepEqual(forged.structuredContent, { ok: false, error: 'caller_identity_unavailable' })
  for (const target of ['../ses_victim/private.txt', path.join(scratch, 'ses_victim', 'private.txt')]) {
    const escaped = await client.callTool({ name: 'scratch_publish', arguments: { path: target }, _meta })
    assert.deepEqual(escaped.structuredContent, { ok: false, error: 'path_outside_scratch' })
  }
  await assert.rejects(fs.stat(attachments), { code: 'ENOENT' })
})

for (const tool of ['dir', 'publish']) {
  test(`scratch_${tool} rejects a session base redirected to another session`, async (t) => {
    const { scratch } = await setup(t)
    const victim = path.join(scratch, 'ses_victim')
    await fs.mkdir(victim, { recursive: true })
    await fs.writeFile(path.join(victim, 'private.txt'), 'private')
    await fs.symlink(victim, path.join(scratch, 'ses_caller'), process.platform === 'win32' ? 'junction' : 'dir')

    const output = JSON.parse(await (tool === 'dir'
      ? scratchDir.execute({}, session('ses_caller'))
      : scratchPublish.execute({ path: 'private.txt' }, session('ses_caller'))))
    assert.deepEqual(output, { ok: false, error: 'path_outside_scratch' })
    assert.deepEqual(await fs.readdir(victim), ['private.txt'])
  })
}
