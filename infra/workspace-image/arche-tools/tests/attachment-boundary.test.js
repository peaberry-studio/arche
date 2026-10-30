import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { readAttachmentBuffer } from '../shared/attachment-tools.js'
import { createWorkspaceTestEnv } from './workspace-test-env.js'

test('attachment reads reject traversal and symlinks outside the workspace', async () => {
  const workspace = await createWorkspaceTestEnv('arche-boundary-')
  const outside = path.resolve(workspace.workspaceDir, '../outside-boundary.txt')
  try {
    await fs.writeFile(outside, 'must not be read')
    const linked = path.join(workspace.attachmentsDir, 'linked.txt')
    await fs.symlink(outside, linked)
    for (const file of [outside, linked]) {
      assert.deepEqual(await readAttachmentBuffer(file), { ok: false, error: 'path_outside_attachments' })
    }
    const inside = path.join(workspace.attachmentsDir, 'inside.txt')
    await fs.writeFile(inside, 'safe')
    const result = await readAttachmentBuffer(inside)
    assert.equal(result.ok, true)
    assert.equal(result.buffer.toString(), 'safe')
  } finally {
    await fs.rm(outside, { force: true })
    await workspace.cleanup()
  }
})
