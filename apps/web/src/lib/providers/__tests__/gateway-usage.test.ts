import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markCredentialLastUsed: vi.fn(),
  recordProviderGatewayRequest: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  providerService: {
    markCredentialLastUsed: mocks.markCredentialLastUsed,
  },
  providerUsageService: {
    recordProviderGatewayRequest: mocks.recordProviderGatewayRequest,
  },
}))

import { markCredentialLastUsedBestEffort, recordProviderGatewayRequestBestEffort } from '@/lib/providers/gateway-usage'

describe('provider gateway usage helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.markCredentialLastUsed.mockResolvedValue(undefined)
    mocks.recordProviderGatewayRequest.mockResolvedValue(undefined)
  })

  it('records gateway requests without awaiting the write', async () => {
    recordProviderGatewayRequestBestEffort({
      credentialSource: 'user',
      isError: true,
      modelId: 'gpt-5.5',
      providerId: 'openai',
      userId: 'user-1',
    })

    await vi.waitFor(() => expect(mocks.recordProviderGatewayRequest).toHaveBeenCalledWith({
      credentialSource: 'user',
      isError: true,
      modelId: 'gpt-5.5',
      providerId: 'openai',
      userId: 'user-1',
    }))
  })

  it('logs best-effort write failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('db down')
    mocks.recordProviderGatewayRequest.mockRejectedValue(error)
    mocks.markCredentialLastUsed.mockRejectedValue(error)

    recordProviderGatewayRequestBestEffort({
      credentialSource: 'organization',
      isError: false,
      modelId: null,
      providerId: 'anthropic',
      userId: 'user-1',
    })
    markCredentialLastUsedBestEffort({ credentialId: 'cred-1', source: 'organization' })

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
      '[providers/gateway] Failed to record usage',
      error,
    ))
    expect(console.warn).toHaveBeenCalledWith('[providers/gateway] Failed to mark credential last used', error)
  })
})
