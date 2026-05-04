import { describe, it, expect, vi } from 'vitest'
import { getConnectorListStatus } from '../list-status'

vi.mock('@/lib/connectors/meta-ads', () => ({
  isMetaAdsConnectorReady: (config: Record<string, unknown>) => config.ready === true,
}))

describe('getConnectorListStatus', () => {
  it('returns disabled when not enabled', () => {
    expect(
      getConnectorListStatus({
        type: 'any',
        enabled: false,
        authType: 'manual',
        oauthConnected: false,
        config: {},
      }),
    ).toBe('disabled')
  })

  it('returns ready for manual auth when enabled', () => {
    expect(
      getConnectorListStatus({
        type: 'any',
        enabled: true,
        authType: 'manual',
        oauthConnected: false,
        config: {},
      }),
    ).toBe('ready')
  })

  it('returns pending for oauth when not connected', () => {
    expect(
      getConnectorListStatus({
        type: 'any',
        enabled: true,
        authType: 'oauth',
        oauthConnected: false,
        config: {},
      }),
    ).toBe('pending')
  })

  it('returns ready for oauth when connected', () => {
    expect(
      getConnectorListStatus({
        type: 'any',
        enabled: true,
        authType: 'oauth',
        oauthConnected: true,
        config: {},
      }),
    ).toBe('ready')
  })

  it('returns ready for meta-ads when oauth connected and config ready', () => {
    expect(
      getConnectorListStatus({
        type: 'meta-ads',
        enabled: true,
        authType: 'oauth',
        oauthConnected: true,
        config: { ready: true },
      }),
    ).toBe('ready')
  })

  it('returns pending for meta-ads when oauth not connected', () => {
    expect(
      getConnectorListStatus({
        type: 'meta-ads',
        enabled: true,
        authType: 'oauth',
        oauthConnected: false,
        config: { ready: true },
      }),
    ).toBe('pending')
  })

  it('returns pending for meta-ads when config not ready', () => {
    expect(
      getConnectorListStatus({
        type: 'meta-ads',
        enabled: true,
        authType: 'oauth',
        oauthConnected: true,
        config: { ready: false },
      }),
    ).toBe('pending')
  })
})
