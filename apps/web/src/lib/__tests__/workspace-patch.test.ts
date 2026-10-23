import { describe, expect, it } from 'vitest'

import { isSafeWorkspacePatch } from '@/lib/workspace-patch'

const patch = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`

describe('workspace patch policy through the Git parser', () => {
  it.each(['notes.md', 'Folder/note with spaces.md'])('accepts an ordinary patch: %s', async (path) => {
    expect(await isSafeWorkspacePatch(patch(path))).toBe(true)
  })
  it.each(['opencode.json', 'AGENTS.md', '.git/config', 'node_modules/tool.js', '../escape'])('rejects protected paths: %s', async (path) => {
    expect(await isSafeWorkspacePatch(patch(path))).toBe(false)
  })
  it('rejects symlink mode changes and malformed patches', async () => {
    expect(await isSafeWorkspacePatch('diff --git a/link b/link\nold mode 100644\nnew mode 120000\n')).toBe(false)
    expect(await isSafeWorkspacePatch('diff --git a/AGENTS.md b/note.md\nsimilarity index 100%\nrename from AGENTS.md\nrename to note.md\n')).toBe(false)
    expect(await isSafeWorkspacePatch('not a patch')).toBe(false)
    expect(await isSafeWorkspacePatch('x'.repeat(2 * 1024 * 1024 + 1))).toBe(false)
  })
})
