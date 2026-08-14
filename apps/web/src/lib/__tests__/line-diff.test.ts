import { describe, expect, it } from 'vitest'

import { createUnifiedDiff } from '@/lib/line-diff'

describe('createUnifiedDiff', () => {
  it('returns an empty string when contents are identical', () => {
    expect(createUnifiedDiff({ oldText: 'a\nb\n', newText: 'a\nb\n' })).toBe('')
  })

  it('marks every line as added for a create operation', () => {
    const diff = createUnifiedDiff({
      oldText: '',
      newText: '# Title\n\nBody\n',
      path: 'Notes/New.md',
      operation: 'create',
    })

    expect(diff).toBe(
      [
        '--- /dev/null',
        '+++ b/Notes/New.md',
        '@@ -0,0 +1,3 @@',
        '+# Title',
        '+',
        '+Body',
      ].join('\n')
    )
  })

  it('marks every line as deleted for a delete operation', () => {
    const diff = createUnifiedDiff({
      oldText: '# Title\nBody\n',
      newText: '',
      path: 'Notes/Old.md',
      operation: 'delete',
    })

    expect(diff).toBe(
      [
        '--- a/Notes/Old.md',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-# Title',
        '-Body',
      ].join('\n')
    )
  })

  it('emits a single hunk with context around a modified line', () => {
    const diff = createUnifiedDiff({
      oldText: 'one\ntwo\nthree\n',
      newText: 'one\nTWO\nthree\n',
      path: 'Notes/A.md',
    })

    expect(diff).toBe(
      [
        '--- a/Notes/A.md',
        '+++ b/Notes/A.md',
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
      ].join('\n')
    )
  })

  it('splits distant changes into separate hunks with correct line numbers', () => {
    const oldLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
    const newLines = oldLines.map((line, i) => (i === 1 || i === 17 ? `${line}*` : line))
    const diff = createUnifiedDiff({
      oldText: `${oldLines.join('\n')}\n`,
      newText: `${newLines.join('\n')}\n`,
      path: 'Notes/A.md',
    })

    const hunks = diff.split('\n').filter((line) => line.startsWith('@@'))
    expect(hunks).toEqual(['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@'])
    expect(diff).toContain('-line 2\n+line 2*')
    expect(diff).toContain('-line 18\n+line 18*')
  })

  it('merges nearby changes into one hunk', () => {
    const oldText = 'a\nb\nc\nd\ne\n'
    const newText = 'A\nb\nc\nd\nE\n'
    const diff = createUnifiedDiff({ oldText, newText, path: 'Notes/A.md' })

    const hunks = diff.split('\n').filter((line) => line.startsWith('@@'))
    expect(hunks).toEqual(['@@ -1,5 +1,5 @@'])
  })

  it('annotates a missing trailing newline', () => {
    const diff = createUnifiedDiff({
      oldText: 'one\ntwo',
      newText: 'one\ntwo\n',
      path: 'Notes/A.md',
    })

    expect(diff).toContain('-two\n\\ No newline at end of file\n+two')
  })
})
