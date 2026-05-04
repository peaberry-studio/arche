/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ConnectorsPage from '@/app/u/[slug]/connectors/page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/components/connectors/connectors-page-client', () => ({
  ConnectorsPageClient: ({ slug }: { slug: string }) => (
    <div data-testid="connectors-page-client">ConnectorsPageClient: {slug}</div>
  ),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: vi.fn(),
  getDesktopWorkspaceHref: vi.fn().mockReturnValue('/desktop/connectors'),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: vi.fn(),
}))

describe('ConnectorsPage', () => {
  it('renders ConnectorsPageClient when not in desktop mode', async () => {
    const { isDesktop } = await import('@/lib/runtime/mode')
    vi.mocked(isDesktop).mockReturnValue(false)

    const page = await ConnectorsPage({ params: Promise.resolve({ slug: 'alice' }) })
    render(page)

    expect(screen.getByTestId('connectors-page-client')).toBeDefined()
  })

  it('redirects to desktop workspace href in desktop mode', async () => {
    const { isDesktop } = await import('@/lib/runtime/mode')
    vi.mocked(isDesktop).mockReturnValue(true)

    const { getCurrentDesktopVault } = await import('@/lib/runtime/desktop/current-vault')
    vi.mocked(getCurrentDesktopVault).mockReturnValue({ id: 'vault-1' })

    const { redirect } = await import('next/navigation')

    await ConnectorsPage({ params: Promise.resolve({ slug: 'alice' }) })

    expect(redirect).toHaveBeenCalledWith('/desktop/connectors')
  })
})
