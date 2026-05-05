import { describe, expect, it } from 'vitest'

import { normalizeKbPath, normalizeKbWritePath } from '../path'

describe('normalizeKbPath', () => {
  it('normalizes relative paths', () => {
    expect(normalizeKbPath('docs/intro.md')).toBe('docs/intro.md')
    expect(normalizeKbPath('docs\\intro.md')).toBe('docs/intro.md')
    expect(normalizeKbPath('docs/')).toBe('docs')
  })

  it('rejects path traversal', () => {
    expect(normalizeKbPath('../etc/passwd')).toBeNull()
    expect(normalizeKbPath('docs/../../etc')).toBeNull()
    expect(normalizeKbPath('docs\\..\\etc')).toBeNull()
  })

  it('rejects absolute paths and empty values', () => {
    expect(normalizeKbPath('/etc/passwd')).toBeNull()
    expect(normalizeKbPath('')).toBeNull()
    expect(normalizeKbPath('   ')).toBeNull()
  })

  it('rejects git control paths, empty segments, and control characters', () => {
    expect(normalizeKbPath('.git/config')).toBeNull()
    expect(normalizeKbPath('docs/.git/hooks/pre-commit')).toBeNull()
    expect(normalizeKbPath('.gitmodules')).toBeNull()
    expect(normalizeKbPath('docs//intro.md')).toBeNull()
    expect(normalizeKbPath('docs/./intro.md')).toBeNull()
    expect(normalizeKbPath('docs/intro\n.md')).toBeNull()
    expect(normalizeKbPath('docs/intro\u001f.md')).toBeNull()
  })
})

describe('normalizeKbWritePath', () => {
  it('rejects trailing directory separators for write targets', () => {
    expect(normalizeKbWritePath('docs/')).toBeNull()
    expect(normalizeKbWritePath('docs\\')).toBeNull()
  })

  it('accepts safe file paths', () => {
    expect(normalizeKbWritePath('docs/intro.md')).toBe('docs/intro.md')
  })
})

