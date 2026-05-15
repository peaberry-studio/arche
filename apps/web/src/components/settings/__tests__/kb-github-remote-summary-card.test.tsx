/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KbGithubRemoteSummaryCard } from '@/components/settings/kb-github-remote-summary-card'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

const baseSummary: KbGithubRemoteIntegrationSummary = {
  appConfigured: false,
  appId: null,
  appSlug: null,
  hasPrivateKey: false,
  installationAccount: null,
  installationId: null,
  lastError: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  ready: false,
  repoDefaultBranch: null,
  repoFullName: null,
  updatedAt: null,
  version: 0,
}

describe('KbGithubRemoteSummaryCard', () => {
  it('shows setup when the integration is not configured', () => {
    render(<KbGithubRemoteSummaryCard slug="alice" integration={baseSummary} />)

    expect(screen.getByText('GitHub KB sync')).toBeTruthy()
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Setup' }).getAttribute('href')).toBe('/u/alice/settings/integrations/kb-github-remote')
  })

  it('shows manage and repository details when ready', () => {
    render(
      <KbGithubRemoteSummaryCard
        slug="alice"
        integration={{
          ...baseSummary,
          appConfigured: true,
          hasPrivateKey: true,
          installationId: 123,
          ready: true,
          repoFullName: 'acme/kb',
        }}
      />,
    )

    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('acme/kb')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage' }).getAttribute('href')).toBe('/u/alice/settings/integrations/kb-github-remote')
  })
})
