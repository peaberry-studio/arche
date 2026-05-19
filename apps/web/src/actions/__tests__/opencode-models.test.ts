import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  flowService: {},
  instanceService: {},
  messageRunService: {},
  slackService: {},
  userService: {
    findIdBySlug: vi.fn(),
  },
}))

vi.mock('@/lib/providers/store', () => ({
  getEnabledProviderIdsForUser: vi.fn(),
}))

import { getSession } from '@/lib/runtime/session'
import { createInstanceClient } from '@/lib/opencode/client'
import { getEnabledProviderIdsForUser } from '@/lib/providers/store'
import type { ProviderId } from '@/lib/providers/types'
import { listModelsAction } from '../opencode'

const mockGetSession = vi.mocked(getSession)
const mockCreateInstanceClient = vi.mocked(createInstanceClient)
const mockGetEnabledProviderIdsForUser = vi.mocked(getEnabledProviderIdsForUser)

function enabledProviders(...providerIds: ProviderId[]): Set<ProviderId> {
  return new Set(providerIds)
}

const providersResponse = {
  data: {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-5.2': { name: 'GPT-5.2', cost: { input: 1, output: 2 } },
        },
      },
      {
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'scene-free': { name: 'Scene Free', cost: { input: 0, output: 0 } },
          'scene-paid': { name: 'Scene Paid', cost: { input: 1, output: 1 } },
        },
      },
    ],
    default: {
      openai: 'gpt-5.2',
      opencode: 'scene-paid',
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()

  mockGetSession.mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'alice@test.com',
      slug: 'alice',
      role: 'USER',
    },
    sessionId: 'sess-1',
  })

  mockCreateInstanceClient.mockResolvedValue({
    config: {
      providers: vi.fn().mockResolvedValue(providersResponse),
    },
  } as never)
})

describe('listModelsAction', () => {
  it('keeps OpenCode Zen models visible without stored credentials', async () => {
    mockGetEnabledProviderIdsForUser.mockResolvedValue(enabledProviders())

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
      ]),
    )
    expect(result.models).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.2' }),
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-paid' }),
      ]),
    )
  })

  it('keeps paid providers gated behind active credentials', async () => {
    mockGetEnabledProviderIdsForUser.mockResolvedValue(enabledProviders('openai'))

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.2' }),
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
      ]),
    )

    expect(result.models).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-paid' }),
      ]),
    )
  })

  it('keeps paid OpenCode Zen models when an OpenCode credential is configured', async () => {
    mockGetEnabledProviderIdsForUser.mockResolvedValue(enabledProviders('opencode'))

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-paid' }),
      ]),
    )
  })

  it('includes models from organization credentials when user has no override', async () => {
    mockCreateInstanceClient.mockResolvedValue({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: {
            providers: [
              {
                id: 'openrouter',
                name: 'OpenRouter',
                models: {
                  'openrouter/auto': { name: 'OpenRouter Auto' },
                },
              },
            ],
            default: {},
          },
        }),
      },
    } as never)

    mockGetEnabledProviderIdsForUser.mockResolvedValue(enabledProviders('openrouter'))

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openrouter', modelId: 'openrouter/auto' }),
      ]),
    )
  })

  it('normalizes fireworks runtime provider ids to the canonical provider id', async () => {
    mockCreateInstanceClient.mockResolvedValue({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: {
            providers: [
              {
                id: 'fireworks-ai',
                name: 'Fireworks AI',
                models: {
                  'accounts/fireworks/models/glm-5': { name: 'GLM-5' },
                },
              },
            ],
            default: {
              'fireworks-ai': 'accounts/fireworks/models/glm-5',
            },
          },
        }),
      },
    } as never)

    mockGetEnabledProviderIdsForUser.mockResolvedValue(enabledProviders('fireworks'))

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'fireworks',
          modelId: 'accounts/fireworks/models/glm-5',
          isDefault: true,
        }),
      ]),
    )
  })
})
