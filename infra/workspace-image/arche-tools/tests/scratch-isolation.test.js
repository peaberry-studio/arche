import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { scratchIsolation } from '../shared/scratch-isolation/index.js'

test('scratch permission hook enforces trusted session ownership for every native file action', async (t) => {
  const base = await mkdtemp(path.join(process.cwd(), '.scratch-isolation-test-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = path.join(base, 'scratch')
  const workspace = path.join(base, 'workspace')
  const own = path.join(root, 'ses_a')
  const other = path.join(root, 'ses_b')
  await Promise.all([own, other, workspace].map((dir) => mkdir(dir, { recursive: true })))
  await symlink(other, path.join(own, 'redirect'), 'dir')
  await symlink(workspace, path.join(own, 'escape'), 'dir')
  await symlink(path.join(other, 'missing.txt'), path.join(own, 'dangling-file'), 'file')
  await symlink(path.join(other, 'missing-dir'), path.join(own, 'dangling-dir'), 'dir')
  await symlink(path.join(own, 'missing.txt'), path.join(own, 'own-dangling'), 'file')
  const alias = path.join(base, 'scratch-alias')
  await symlink(root, alias, 'dir')
  await symlink(other, path.join(workspace, 'redirect'), 'dir')
  let evaluate
  await scratchIsolation.setup({
    options: { root }, location: { directory: workspace },
    permission: { hook: async (name, callback) => { assert.equal(name, 'evaluate'); evaluate = callback } },
  })
  for (const action of ['read', 'edit', 'glob', 'grep', 'external_directory']) {
    await t.test(action, async () => {
      const event = (target, effect = 'allow') => ({
        sessionID: 'ses_a', action, effect,
        resources: action === 'external_directory' ? [`${target}/*`] : action === 'glob' || action === 'grep' ? ['*'] : [target],
        metadata: { path: target },
      })
      const allowed = event(path.join(own, 'nested'), action === 'external_directory' ? 'ask' : 'allow')
      await evaluate(allowed)
      assert.equal(allowed.effect, 'allow', 'own session remains prompt-free')
      const ownDangling = event(path.join(own, 'own-dangling'), action === 'external_directory' ? 'ask' : 'allow')
      await evaluate(ownDangling)
      assert.equal(ownDangling.effect, 'allow', 'own dangling links stay in the caller folder')
      for (const target of [other, root, base, path.join(root, 'ses_ab'), path.join(own, '../ses_b'), path.join(own, 'redirect'), path.join(own, 'escape'), path.join(own, 'dangling-file'), path.join(own, 'dangling-dir/new.txt'), path.join(workspace, 'redirect')]) {
        const denied = event(target)
        await evaluate(denied)
        assert.equal(denied.effect, 'deny', `${target} is denied even after configured/saved allows`)
        assert.match(denied.message, /calling session/)
      }
      const existingDeny = event(own, 'deny')
      await evaluate(existingDeny)
      assert.equal(existingDeny.effect, 'deny', 'does not lift other guards')
      const outside = event(path.join(base, 'unrelated'), 'ask')
      await evaluate(outside)
      assert.equal(outside.effect, 'ask', 'unrelated paths keep their permissions')
      if (action === 'external_directory') {
        const aliased = event(path.join(alias, 'ses_a'), 'ask')
        await evaluate(aliased)
        assert.equal(aliased.effect, 'allow', 'canonical temp-directory aliases keep own scratch prompt-free')
      }
    })
  }
  const shell = { sessionID: 'ses_a', action: 'shell', resources: ['ls'], effect: 'ask' }
  await evaluate(shell)
  assert.equal(shell.effect, 'ask', 'shell remains outside this boundary')
})
