/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/components/agents/agents-page', () => ({
  AgentsPageClient: ({ slug, isAdmin }: { slug: string; isAdmin: boolean }) => (
    <div data-testid="agents-page-client">{slug} {String(isAdmin)}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => {
    if (asChild) return <>{children}</>
    return <button type="button">{children}</button>
  },
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

describe('AgentsPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders heading, description, create button and AgentsPageClient for admins', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByText('Review shared agents defined in the knowledge base.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create agent' }).getAttribute('href')).toBe('/u/alice/agents/new')
    expect(screen.getByTestId('agents-page-client').textContent).toBe('alice true')
  })

  it('renders heading without create button for non-admins', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create agent' })).toBeNull()
    expect(screen.getByTestId('agents-page-client').textContent).toBe('alice false')
  })
})
