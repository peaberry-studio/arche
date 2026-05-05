/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConnectorsPage from '@/app/u/[slug]/connectors/page'

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getDesktopWorkspaceHrefMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/connectors/connectors-page-client', () => ({
  ConnectorsPageClient: ({ slug }: { slug: string }) => (
    <div data-testid="connectors-page-client">ConnectorsPageClient: {slug}</div>
  ),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
  getDesktopWorkspaceHref: (...args: unknown[]) => getDesktopWorkspaceHrefMock(...args),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

describe('ConnectorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getDesktopWorkspaceHrefMock.mockReturnValue('/desktop/connectors')
  })

  it('renders ConnectorsPageClient when not in desktop mode', async () => {
    const page = await ConnectorsPage({ params: Promise.resolve({ slug: 'alice' }) })
    render(page)

    expect(screen.getByTestId('connectors-page-client')).toBeDefined()
  })

  it('redirects to desktop workspace href in desktop mode', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ id: 'vault-1' })

    await expect(ConnectorsPage({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'REDIRECT:/desktop/connectors',
    )

    expect(getDesktopWorkspaceHrefMock).toHaveBeenCalledWith('local', 'connectors')
  })

  it('redirects desktop users to the launcher when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(ConnectorsPage({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/')
    expect(getDesktopWorkspaceHrefMock).not.toHaveBeenCalled()
  })
})
