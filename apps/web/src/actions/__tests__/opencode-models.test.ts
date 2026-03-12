import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

import { getSession } from '@/lib/runtime/session'
import { createInstanceClient } from '@/lib/opencode/client'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { listModelsAction } from '../opencode'

const mockGetSession = vi.mocked(getSession)
const mockCreateInstanceClient = vi.mocked(createInstanceClient)
const mockGetActiveCredentialForUser = vi.mocked(getActiveCredentialForUser)

const providersResponse = {
  data: {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-5.2': { name: 'GPT-5.2' },
        },
      },
      {
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'scene-free': { name: 'Scene Free' },
        },
      },
    ],
    default: {
      openai: 'gpt-5.2',
      opencode: 'scene-free',
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
    mockGetActiveCredentialForUser.mockResolvedValue(null)

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
      ]),
    )
  })

  it('keeps paid providers gated behind active credentials', async () => {
    mockGetActiveCredentialForUser.mockImplementation(async ({ providerId }) => {
      if (providerId === 'openai') {
        return {
          id: 'cred-openai',
          type: 'api',
          secret: 'encrypted',
          version: 1,
        }
      }

      return null
    })

    const result = await listModelsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.2' }),
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
      ]),
    )
  })
})
