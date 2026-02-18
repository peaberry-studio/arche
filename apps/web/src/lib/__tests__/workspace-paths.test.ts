import { describe, expect, it } from 'vitest'

import {
  isHiddenWorkspacePath,
  isInternalWorkspacePath,
  isNodeModulesWorkspacePath,
  isProtectedWorkspacePath,
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

  it('detects protected workspace paths', () => {
    expect(isProtectedWorkspacePath('.gitignore')).toBe(true)
    expect(isProtectedWorkspacePath('.gitkeep')).toBe(true)
    expect(isProtectedWorkspacePath('Company/.gitkeep')).toBe(true)
    expect(isProtectedWorkspacePath('AGENTS.md')).toBe(true)
    expect(isProtectedWorkspacePath('opencode.json')).toBe(true)
    expect(isProtectedWorkspacePath('packages/web/node_modules/react/index.js')).toBe(true)
    expect(isProtectedWorkspacePath('Company/Product/README.md')).toBe(false)
  })

  it('detects node_modules paths', () => {
    expect(isNodeModulesWorkspacePath('node_modules/react/index.js')).toBe(true)
    expect(isNodeModulesWorkspacePath('packages/web/node_modules/.bin/eslint')).toBe(true)
    expect(isNodeModulesWorkspacePath('packages/web/src/app/page.tsx')).toBe(false)
  })

  it('detects hidden workspace paths', () => {
    expect(isHiddenWorkspacePath('.arche/attachments/a.txt')).toBe(true)
    expect(isHiddenWorkspacePath('node_modules/react/index.js')).toBe(true)
    expect(isHiddenWorkspacePath('Company/.gitkeep')).toBe(true)
    expect(isHiddenWorkspacePath('AGENTS.md')).toBe(true)
    expect(isHiddenWorkspacePath('Company/Product/README.md')).toBe(false)
  })

  it('validates context references', () => {
    expect(isValidContextReferencePath('')).toBe(false)
    expect(isValidContextReferencePath('.arche/secret.txt')).toBe(false)
    expect(isValidContextReferencePath('AGENTS.md')).toBe(false)
    expect(isValidContextReferencePath('Company/.gitkeep')).toBe(false)
    expect(isValidContextReferencePath('node_modules/react/index.js')).toBe(false)
    expect(isValidContextReferencePath('src/../secret.txt')).toBe(false)
    expect(isValidContextReferencePath('src/app/page.tsx')).toBe(true)
  })

  it('keeps normalizeAttachmentPath as workspace alias', () => {
    expect(normalizeAttachmentPath('/.arche//attachments//report.pdf')).toBe(
      '.arche/attachments/report.pdf',
    )
  })
})
