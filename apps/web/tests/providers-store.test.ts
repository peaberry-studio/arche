import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    providerCredential: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/providers/crypto', () => ({
  encryptProviderSecret: vi.fn(() => 'encrypted-secret'),
}))

import { prisma } from '@/lib/prisma'
import { encryptProviderSecret } from '@/lib/providers/crypto'
import { createApiCredential, getActiveCredentialForUser } from '@/lib/providers/store'

const mockPrisma = vi.mocked(prisma)
const mockEncrypt = vi.mocked(encryptProviderSecret)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('providers/store', () => {
  it('creates api credential with encrypted secret', async () => {
    mockPrisma.providerCredential.create.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted-secret',
      version: 2,
    } as never)

    const result = await createApiCredential({
      userId: 'user-1',
      providerId: 'openai',
      apiKey: 'sk-123',
      version: 2,
    })

    expect(mockEncrypt).toHaveBeenCalledWith({ apiKey: 'sk-123' })
    expect(mockPrisma.providerCredential.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        providerId: 'openai',
        type: 'api',
        status: 'enabled',
        version: 2,
        secret: 'encrypted-secret',
      },
      select: {
        id: true,
        type: true,
        secret: true,
        version: true,
      },
    })
    expect(result).toEqual({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted-secret',
      version: 2,
    })
  })

  it('returns active credential for user and provider', async () => {
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'cred-2',
      type: 'api',
      secret: 'encrypted-secret',
      version: 3,
    } as never)

    const result = await getActiveCredentialForUser({
      userId: 'user-1',
      providerId: 'openai',
    })

    expect(mockPrisma.providerCredential.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        providerId: 'openai',
        status: 'enabled',
      },
      orderBy: {
        version: 'desc',
      },
      select: {
        id: true,
        type: true,
        secret: true,
        version: true,
      },
    })
    expect(result).toEqual({
      id: 'cred-2',
      type: 'api',
      secret: 'encrypted-secret',
      version: 3,
    })
  })
})
