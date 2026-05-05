/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

const getSessionMock = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/agents/web-agent-form', () => ({
  WebAgentForm: ({ slug, mode }: { slug: string; mode: string }) => (
    <div data-testid="web-agent-form">{slug} {mode}</div>
  ),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

describe('NewAgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the create agent page for admins', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice' }) }))

    expect(screen.getByRole('heading', { name: 'Create agent' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to agents/ }).getAttribute('href')).toBe('/u/alice/agents')
    expect(screen.getByTestId('web-agent-form').textContent).toBe('alice create')
  })

  it('redirects non-admin users to the agents list', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice/agents')
  })
})
