import { describe, expect, it } from 'vitest'

import {
  isInternalWorkspacePath,
  isValidContextReferencePath,
  normalizeAttachmentPath,
  normalizeWorkspacePath,
} from '@/lib/workspace-paths'

describe('workspace path normalization', () => {
  it('normalizes slashes, trim, and dot segments', () => {
    expect(normalizeWorkspacePath('  ./foo//bar\\baz  ')).toBe('foo/bar/baz')
  })

  it('keeps dot-dot segments for downstream validation', () => {
    expect(normalizeWorkspacePath('src/../secrets.txt')).toBe('src/../secrets.txt')
  })

  it('detects internal .arche paths', () => {
    expect(isInternalWorkspacePath('.arche')).toBe(true)
    expect(isInternalWorkspacePath('.arche/attachments/a.txt')).toBe(true)
    expect(isInternalWorkspacePath('src/app/page.tsx')).toBe(false)
  })

  it('validates context references', () => {
    expect(isValidContextReferencePath('')).toBe(false)
    expect(isValidContextReferencePath('.arche/secret.txt')).toBe(false)
    expect(isValidContextReferencePath('src/../secret.txt')).toBe(false)
    expect(isValidContextReferencePath('src/app/page.tsx')).toBe(true)
  })

  it('keeps normalizeAttachmentPath as workspace alias', () => {
    expect(normalizeAttachmentPath('/.arche//attachments//report.pdf')).toBe(
      '.arche/attachments/report.pdf',
    )
  })
})
