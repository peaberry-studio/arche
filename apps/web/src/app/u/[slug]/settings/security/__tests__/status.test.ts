import { describe, expect, it } from 'vitest'

import { normalizeTwoFactorStatus } from '../status'

describe('normalizeTwoFactorStatus', () => {
  it('returns disabled defaults for missing or failed status', () => {
    expect(normalizeTwoFactorStatus(null)).toEqual({
      enabled: false,
      verifiedAt: null,
      recoveryCodesRemaining: 0,
    })

    expect(normalizeTwoFactorStatus({ ok: false, error: 'Not authenticated' })).toEqual({
      enabled: false,
      verifiedAt: null,
      recoveryCodesRemaining: 0,
    })
  })

  it('returns 2FA details for a successful status', () => {
    const verifiedAt = new Date('2026-03-12T10:00:00.000Z')

    expect(
      normalizeTwoFactorStatus({
        ok: true,
        enabled: true,
        verifiedAt,
        recoveryCodesRemaining: 4,
      }),
    ).toEqual({
      enabled: true,
      verifiedAt,
      recoveryCodesRemaining: 4,
    })
  })
})
