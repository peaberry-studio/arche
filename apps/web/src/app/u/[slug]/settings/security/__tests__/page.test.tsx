/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import LegacySecuritySettingsPage from '@/app/u/[slug]/settings/security/page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('LegacySecuritySettingsPage', () => {
  it('redirects to settings page with security section', async () => {
    const { redirect } = await import('next/navigation')

    await LegacySecuritySettingsPage({ params: Promise.resolve({ slug: 'alice' }) })

    expect(redirect).toHaveBeenCalledWith('/u/alice/settings?section=security')
  })
})
