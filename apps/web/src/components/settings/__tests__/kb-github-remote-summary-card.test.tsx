/** @vitest-environment jsdom */

import type { ReactNode } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: { children: ReactNode; variant?: string; className?: string }) => (
    <span data-testid="badge" data-variant={variant} className={className}>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, size, variant }: { children: ReactNode; asChild?: boolean; size?: string; variant?: string }) => {
    if (asChild) return <>{children}</>
    return <button data-size={size} data-variant={variant}>{children}</button>
  },
}))

afterEach(() => {
  cleanup()
})

const baseSummary: KbGithubRemoteIntegrationSummary = {
  appId: null,
  appSlug: null,
  appConfigured: false,
  hasPrivateKey: false,
  installationId: null,
  repoFullName: null,
  ready: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastError: null,
  remoteBranch: null,
  version: 0,
  updatedAt: null,
}

describe('KbGithubRemoteSummaryCard', () => {
  async function renderCard(overrides: Partial<KbGithubRemoteIntegrationSummary> = {}) {
    const { KbGithubRemoteSummaryCard } = await import('../kb-github-remote-summary-card')
    return render(
      <KbGithubRemoteSummaryCard slug="alice" integration={{ ...baseSummary, ...overrides }} />,
    )
  }

  it('renders title and Setup link when not configured', async () => {
    await renderCard()

    expect(screen.getByText('GitHub KB Backup')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Setup' })
    expect(link.getAttribute('href')).toBe('/u/alice/settings/integrations/kb-github-remote')
    expect(screen.getByText('Not configured')).toBeTruthy()
  })

  it('shows Setup incomplete when app configured but not ready', async () => {
    await renderCard({ appConfigured: true })

    expect(screen.getByText('Setup incomplete')).toBeTruthy()
  })

  it('shows Connected badge and Manage link when ready', async () => {
    await renderCard({
      appConfigured: true,
      hasPrivateKey: true,
      installationId: 99,
      repoFullName: 'owner/repo',
      ready: true,
    })

    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage' })).toBeTruthy()
    expect(screen.getByText('Syncing with owner/repo')).toBeTruthy()
  })

  it('shows default description when no repo', async () => {
    await renderCard()

    expect(screen.getByText(/Back up and sync your knowledge base/)).toBeTruthy()
  })

  it('shows sync error badge', async () => {
    await renderCard({ lastSyncStatus: 'error', ready: true, appConfigured: true })

    expect(screen.getByText('Sync error')).toBeTruthy()
  })

  it('shows conflicts badge', async () => {
    await renderCard({ lastSyncStatus: 'conflicts', ready: true, appConfigured: true })

    expect(screen.getByText('Conflicts')).toBeTruthy()
  })

  it('shows last sync time when available', async () => {
    await renderCard({
      lastSyncAt: '2026-05-01T10:00:00Z',
      ready: true,
      appConfigured: true,
    })

    expect(screen.getByText(/Last synced/)).toBeTruthy()
  })

  it('does not show last sync time when null', async () => {
    await renderCard({ ready: true, appConfigured: true })

    expect(screen.queryByText(/Last synced/)).toBeNull()
  })

  it('does not show sync error badge for success status', async () => {
    await renderCard({ lastSyncStatus: 'success', ready: true, appConfigured: true })

    expect(screen.queryByText('Sync error')).toBeNull()
    expect(screen.queryByText('Conflicts')).toBeNull()
  })
})
