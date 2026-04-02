import { describe, expect, it } from 'vitest'

import { isPathSafe, normalizeKbPath } from '../path'

describe('normalizeKbPath', () => {
  it('normalizes relative paths', () => {
    expect(normalizeKbPath('docs/intro.md')).toBe('docs/intro.md')
    expect(normalizeKbPath('docs\\intro.md')).toBe('docs/intro.md')
    expect(normalizeKbPath('./docs//guides/')).toBe('docs/guides')
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
})

describe('isPathSafe', () => {
  it('allows simple relative paths', () => {
    expect(isPathSafe('docs/intro.md')).toBe(true)
    expect(isPathSafe('README.md')).toBe(true)
  })

  it('rejects invalid paths', () => {
    expect(isPathSafe('../etc/passwd')).toBe(false)
    expect(isPathSafe('/etc/passwd')).toBe(false)
  })
})
