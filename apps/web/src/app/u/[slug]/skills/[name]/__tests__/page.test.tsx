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

vi.mock('@/components/skills/web-skill-form', () => ({
  WebSkillForm: ({ slug, mode, skillName }: { slug: string; mode: string; skillName?: string }) => (
    <div data-testid="web-skill-form">{slug} {mode} {skillName ?? 'no-name'}</div>
  ),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

describe('EditSkillPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the edit skill page for admins', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    render(await Page({ params: Promise.resolve({ slug: 'alice', name: 'my-skill' }) }))

    expect(screen.getByRole('heading', { name: 'Edit skill' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to skills/ }).getAttribute('href')).toBe('/u/alice/skills')
    expect(screen.getByTestId('web-skill-form').textContent).toBe('alice edit my-skill')
  })

  it('redirects non-admin users to the skills list', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })

    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice', name: 'my-skill' }) })).rejects.toThrow(
      'REDIRECT:/u/alice/skills',
    )
  })
})
