/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaAdsConnectorSettingsDialog } from '@/components/connectors/meta-ads-connector-settings-dialog'

type MetaAdsSettingsResponse = {
  appId: string
  hasAppSecret: boolean
  permissions: {
    allowRead: boolean
    allowWriteCampaigns: boolean
    allowWriteAdSets: boolean
    allowWriteAds: boolean
  }
  oauthConnected: boolean
  oauthExpiresAt?: string
  selectedAdAccountIds: string[]
  defaultAdAccountId?: string
  adAccounts: Array<{
    id: string
    accountId: string
    name: string
    accountStatus?: number
    currency?: string
    timezoneName?: string
  }>
  adAccountsError?: string
  redirectUri: string
}

function buildSettingsResponse(overrides?: Partial<MetaAdsSettingsResponse>): MetaAdsSettingsResponse {
  return {
    appId: 'meta-app-id',
    hasAppSecret: true,
    permissions: {
      allowRead: true,
      allowWriteCampaigns: false,
      allowWriteAdSets: false,
      allowWriteAds: false,
    },
    oauthConnected: true,
    oauthExpiresAt: '2026-02-01T00:00:00.000Z',
    selectedAdAccountIds: ['act_123', 'act_456'],
    defaultAdAccountId: 'act_123',
    adAccounts: [
      {
        id: 'act_123',
        accountId: '123',
        name: 'Main account',
        currency: 'EUR',
      },
      {
        id: 'act_456',
        accountId: '456',
        name: 'Backup account',
        currency: 'USD',
      },
    ],
    redirectUri: 'http://localhost/api/connectors/oauth/callback',
    ...overrides,
  }
}

function getAccountSwitch(name: string): HTMLButtonElement {
  const labelElement = screen.getByText(name)
  const field = labelElement.parentElement?.parentElement
  const switchElement = field?.querySelector('[role="switch"]')

  if (!(switchElement instanceof HTMLButtonElement)) {
    throw new Error(`Switch not found for ${name}`)
  }

  return switchElement
}

describe('MetaAdsConnectorSettingsDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not submit default values when the initial load fails', async () => {
    let resolveFetch: ((value: { ok: boolean; json: () => Promise<null> }) => void) | undefined
    const fetchMock = vi.fn().mockReturnValueOnce(
      new Promise<{ ok: boolean; json: () => Promise<null> }>((resolve) => {
        resolveFetch = resolve
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    render(
      <MetaAdsConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-meta-1"
        connectorName="Meta Ads"
        onOpenChange={vi.fn()}
      />
    )

    expect(await screen.findByText('Loading settings...')).toBeTruthy()

    resolveFetch?.({
      ok: false,
      json: async () => null,
    })

    expect(await screen.findByText('Failed to load connector settings.')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).toBeNull()
    })

    const saveButton = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps ad account switches disabled until OAuth is connected', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => buildSettingsResponse({
        oauthConnected: false,
        oauthExpiresAt: undefined,
        selectedAdAccountIds: [],
        defaultAdAccountId: undefined,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MetaAdsConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-meta-1"
        connectorName="Meta Ads"
        onOpenChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText('Connect OAuth from the connector card before selecting ad accounts.')).toBeTruthy()
    expect(getAccountSwitch('Main account').disabled).toBe(true)
    expect(getAccountSwitch('Backup account').disabled).toBe(true)
    expect(screen.queryByLabelText('Default ad account')).toBeNull()
  })

  it('reassigns the default ad account after deselecting it and submits the updated payload', async () => {
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildSettingsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => buildSettingsResponse({
          selectedAdAccountIds: ['act_456'],
          defaultAdAccountId: 'act_456',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MetaAdsConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-meta-1"
        connectorName="Meta Ads"
        onOpenChange={onOpenChange}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const defaultSelect = await screen.findByLabelText('Default ad account') as HTMLSelectElement
    expect(defaultSelect.value).toBe('act_123')

    fireEvent.click(getAccountSwitch('Main account'))

    await waitFor(() => {
      expect((screen.getByLabelText('Default ad account') as HTMLSelectElement).value).toBe('act_456')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const [, patchRequest] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(patchRequest.method).toBe('PATCH')
    expect(JSON.parse(String(patchRequest.body))).toEqual({
      appId: 'meta-app-id',
      appSecret: '',
      permissions: {
        allowRead: true,
        allowWriteCampaigns: false,
        allowWriteAdSets: false,
        allowWriteAds: false,
      },
      selectedAdAccountIds: ['act_456'],
      defaultAdAccountId: 'act_456',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
