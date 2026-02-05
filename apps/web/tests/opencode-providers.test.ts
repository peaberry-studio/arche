import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: vi.fn(),
}))

vi.mock('@/lib/providers/config', () => ({
  getGatewayBaseUrlForProvider: vi.fn(),
}))

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(),
}))

import { createInstanceClient } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getGatewayBaseUrlForProvider } from '@/lib/providers/config'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'

const mockCreateInstanceClient = vi.mocked(createInstanceClient)
const mockGetGatewayBaseUrlForProvider = vi.mocked(getGatewayBaseUrlForProvider)
const mockGetActiveCredentialForUser = vi.mocked(getActiveCredentialForUser)
const mockIssueGatewayToken = vi.mocked(issueGatewayToken)

describe('syncProviderAccessForInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns instance_unavailable when client is missing', async () => {
    mockCreateInstanceClient.mockResolvedValue(null)

    const result = await syncProviderAccessForInstance({ slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('updates config and sets auth for active credentials', async () => {
    const mockConfigUpdate = vi.fn().mockResolvedValue({})
    const mockAuthSet = vi.fn().mockResolvedValue({})
    const mockInstanceDispose = vi.fn().mockResolvedValue({})
    mockCreateInstanceClient.mockResolvedValue({
      config: { update: mockConfigUpdate },
      auth: { set: mockAuthSet },
      instance: { dispose: mockInstanceDispose },
    } as never)

    mockGetGatewayBaseUrlForProvider.mockImplementation(
      (providerId) => `https://gateway/${providerId}`
    )

    mockGetActiveCredentialForUser.mockImplementation(async ({ providerId }) => {
      if (providerId === 'openai') {
        return { id: 'cred-1', type: 'api', secret: 'secret', version: 2 }
      }
      return null
    })

    mockIssueGatewayToken.mockImplementation(
      ({ providerId }) => `token-${providerId}`
    )

    const result = await syncProviderAccessForInstance({ slug: 'alice', userId: 'user-1' })

    expect(mockConfigUpdate).toHaveBeenCalledWith({
      config: {
        enabled_providers: ['openai'],
        provider: {
          openai: {
            options: {
              baseURL: 'https://gateway/openai',
            },
          },
        },
      },
    })
    expect(mockIssueGatewayToken).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceSlug: 'alice',
      providerId: 'openai',
      version: 2,
    })
    expect(mockAuthSet).toHaveBeenCalledWith({
      providerID: 'openai',
      auth: { type: 'api', key: 'token-openai' },
    })
    expect(mockInstanceDispose).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })
})
