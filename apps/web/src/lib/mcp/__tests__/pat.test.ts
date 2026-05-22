import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/security', () => ({ getSessionPepper: () => 'pepper' }))

import { generatePat, generatePatSalt, hasPatPrefix, hashPat, verifyPat } from '@/lib/mcp/pat'

describe('MCP PAT helpers', () => {
  it('generates prefixed tokens', () => {
    expect(hasPatPrefix(generatePat())).toBe(true)
  })

  it('verifies salted hashes and rejects wrong tokens', () => {
    const salt = generatePatSalt()
    const hash = hashPat('arche_pat_token', salt)

    expect(verifyPat('arche_pat_token', salt, hash)).toBe(true)
    expect(verifyPat('arche_pat_other', salt, hash)).toBe(false)
  })
})
