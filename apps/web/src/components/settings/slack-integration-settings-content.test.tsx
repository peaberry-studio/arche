/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    fireEvent.click(screen.getByRole('button', { name: 'Panel refresh 0' }))

    expect(screen.getByRole('button', { name: 'Panel refresh 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Danger refresh 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Danger refresh 1' }))

    expect(screen.getByRole('button', { name: 'Panel refresh 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Danger refresh 2' })).toBeTruthy()
  })
})
