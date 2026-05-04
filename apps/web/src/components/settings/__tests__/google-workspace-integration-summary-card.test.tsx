/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GoogleWorkspaceIntegrationSummaryCard } from '@/components/settings/google-workspace-integration-summary-card'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('GoogleWorkspaceIntegrationSummaryCard', () => {
  it('renders configured state', () => {
    render(
      <GoogleWorkspaceIntegrationSummaryCard
        slug="alice"
        integration={{
          clientId: 'client-id-123',
          configured: true,
          hasClientSecret: true,
          updatedAt: '2024-01-01T00:00:00Z',
          version: 1,
        }}
      />
    )

    expect(screen.getByText('Google Workspace integration')).toBeDefined()
    expect(screen.getByText('Configured')).toBeDefined()
    expect(
      screen.getByText(
        'Manage the Google Workspace OAuth client credentials used for all Google connectors.'
      )
    ).toBeDefined()
    expect(screen.getByRole('link', { name: 'Setup' })).toBeDefined()
  })

  it('renders not configured state', () => {
    render(
      <GoogleWorkspaceIntegrationSummaryCard
        slug="alice"
        integration={{
          clientId: null,
          configured: false,
          hasClientSecret: false,
          updatedAt: null,
          version: 0,
        }}
      />
    )

    expect(screen.getByText('Not configured')).toBeDefined()
    const links = screen.queryAllByRole('link', { name: 'Setup' })
    expect(links.length).toBe(1)
  })
})
