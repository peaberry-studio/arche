/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/connectors/connectors-panel', () => ({
  ConnectorsPanel: ({ slug, oauthReturnTo }: { slug: string; oauthReturnTo?: string }) => (
    <div>Connectors {slug} {oauthReturnTo}</div>
  ),
}))

vi.mock('@/components/providers/provider-credentials-panel', () => ({
  ProviderCredentialsPanel: ({ slug }: { slug: string }) => <div>Provider credentials {slug}</div>,
}))

vi.mock('@/components/settings/slack-integration-panel', () => ({
  SlackIntegrationPanel: ({
    onMutated,
    refreshVersion,
  }: {
    onMutated?: () => void
    refreshVersion?: number
  }) => (
    <button type="button" onClick={onMutated}>
      Panel refresh {refreshVersion ?? 0}
    </button>
  ),
}))

vi.mock('@/components/settings/slack-integration-danger-zone', () => ({
  SlackIntegrationDangerZone: ({
    onMutated,
    refreshVersion,
  }: {
    onMutated?: () => void
    refreshVersion?: number
  }) => (
    <button type="button" onClick={onMutated}>
      Danger refresh {refreshVersion ?? 0}
    </button>
  ),
}))

describe('SlackIntegrationSettingsContent', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps the panel and danger zone refresh state in sync after mutations', async () => {
    const { SlackIntegrationSettingsContent } = await import('./slack-integration-settings-content')

    render(
      <SlackIntegrationSettingsContent
        serviceUserSlug="slack-bot"
        showProviderCredentials
        slug="alice"
      />,
    )

    expect(screen.getByRole('button', { name: 'Panel refresh 0' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Danger refresh 0' })).toBeTruthy()
    expect(screen.getByText('Connectors slack-bot /u/alice/settings/integrations/slack')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Panel refresh 0' }))

    expect(screen.getByRole('button', { name: 'Panel refresh 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Danger refresh 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Danger refresh 1' }))

    expect(screen.getByRole('button', { name: 'Panel refresh 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Danger refresh 2' })).toBeTruthy()
  })

  it('hides service workspace panels when the reserved service user is unavailable', async () => {
    const { SlackIntegrationSettingsContent } = await import('./slack-integration-settings-content')

    render(
      <SlackIntegrationSettingsContent
        serviceUserSlug="slack-bot"
        showProviderCredentials={false}
        slug="alice"
      />,
    )

    expect(screen.queryByText(/Provider credentials slack-bot/)).toBeNull()
    expect(screen.queryByText(/Connectors slack-bot/)).toBeNull()
  })
})
