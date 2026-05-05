/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const isDesktopMock = vi.fn()
const getCurrentDesktopVaultMock = vi.fn()
const getRuntimeCapabilitiesMock = vi.fn()
const ensureAutopilotSchedulerStartedMock = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/autopilot/autopilot-page', () => ({
  AutopilotPage: ({ slug }: { slug: string }) => <div data-testid="autopilot-page">{slug}</div>,
}))

vi.mock('@/lib/autopilot/scheduler-bootstrap', () => ({
  ensureAutopilotSchedulerStarted: () => ensureAutopilotSchedulerStartedMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

describe('AutopilotListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to home when desktop mode has no vault', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue(null)

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/')
  })

  it('redirects desktop users with a vault to the workspace page', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultId: 'v1', vaultName: 'Arche', vaultPath: '/tmp/Arche' })

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects when autopilot capability is disabled', async () => {
    isDesktopMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({ autopilot: false })

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('renders AutopilotPage when autopilot is enabled', async () => {
    isDesktopMock.mockReturnValue(false)
    getRuntimeCapabilitiesMock.mockReturnValue({ autopilot: true })
    ensureAutopilotSchedulerStartedMock.mockResolvedValue(undefined)

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByTestId('autopilot-page').textContent).toBe('alice')
    expect(ensureAutopilotSchedulerStartedMock).toHaveBeenCalledTimes(1)
  })
})
