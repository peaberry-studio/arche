import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  providerUsageDaily: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  providerUsageRun: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  getProviderUsageSummary,
  listProviderUsageProviders,
  listProviderUsageUsers,
  recordProviderGatewayRequest,
  recordProviderRunUsage,
} from '../provider-usage'

function decimal(value: number) {
  return { toNumber: () => value }
}

describe('providerUsageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations))
    mockPrisma.providerUsageDaily.findMany.mockResolvedValue([])
  })

  describe('recordProviderGatewayRequest', () => {
    it('increments request and error counts in the daily aggregate', async () => {
      await recordProviderGatewayRequest({
        credentialSource: 'organization',
        isError: true,
        modelId: 'gpt-5.5',
        providerId: 'openai',
        requestedAt: new Date('2026-05-17T18:30:00.000Z'),
        userId: 'u1',
      })

      expect(mockPrisma.providerUsageDaily.upsert).toHaveBeenCalledWith({
        where: {
          bucketDate_userId_providerId_modelId_source_credentialSource: {
            bucketDate: new Date('2026-05-17T00:00:00.000Z'),
            credentialSource: 'organization',
            modelId: 'gpt-5.5',
            providerId: 'openai',
            source: 'gateway',
            userId: 'u1',
          },
        },
        create: expect.objectContaining({
          bucketDate: new Date('2026-05-17T00:00:00.000Z'),
          credentialSource: 'organization',
          errorCount: 1,
          modelId: 'gpt-5.5',
          providerId: 'openai',
          requestCount: 1,
          source: 'gateway',
          userId: 'u1',
        }),
        update: {
          errorCount: { increment: 1 },
          requestCount: { increment: 1 },
        },
      })
    })

    it('normalizes blank model and source values for successful requests', async () => {
      await recordProviderGatewayRequest({
        credentialSource: 'default',
        isError: false,
        modelId: '   ',
        providerId: 'opencode',
        requestedAt: new Date('2026-05-17T18:30:00.000Z'),
        source: '',
        userId: 'u1',
      })

      expect(mockPrisma.providerUsageDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          errorCount: 0,
          modelId: '',
          requestCount: 1,
          source: 'unknown',
        }),
        update: {
          errorCount: { increment: 0 },
          requestCount: { increment: 1 },
        },
      }))
    })
  })

  describe('recordProviderRunUsage', () => {
    it('creates a run dedupe record and increments run tokens and cost', async () => {
      const result = await recordProviderRunUsage({
        costUsd: 0.125,
        credentialSource: 'user',
        inputTokens: 100,
        messageRunId: 'run-1',
        modelId: 'claude-sonnet',
        outputTokens: 50,
        providerId: 'anthropic',
        recordedAt: new Date('2026-05-18T02:00:00.000Z'),
        source: 'web',
        userId: 'u1',
      })

      expect(result).toEqual({ ok: true, recorded: true })
      expect(mockPrisma.providerUsageRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          credentialSource: 'user',
          inputTokens: 100,
          messageRunId: 'run-1',
          modelId: 'claude-sonnet',
          outputTokens: 50,
          providerId: 'anthropic',
          source: 'web',
          userId: 'u1',
        }),
      })
      expect(mockPrisma.providerUsageDaily.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            inputTokens: { increment: 100 },
            outputTokens: { increment: 50 },
            runCount: { increment: 1 },
          }),
        }),
      )
    })

    it('does not increment aggregates when the message run was already recorded', async () => {
      mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' })

      const result = await recordProviderRunUsage({
        costUsd: 0.125,
        credentialSource: 'user',
        inputTokens: 100,
        messageRunId: 'run-1',
        outputTokens: 50,
        providerId: 'anthropic',
        source: 'web',
        userId: 'u1',
      })

      expect(result).toEqual({ ok: true, recorded: false })
    })

    it('rethrows non-unique transaction errors', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('db down'))

      await expect(recordProviderRunUsage({
        costUsd: 0.125,
        credentialSource: 'user',
        inputTokens: 100,
        messageRunId: 'run-1',
        outputTokens: 50,
        providerId: 'anthropic',
        source: 'web',
        userId: 'u1',
      })).rejects.toThrow('db down')
    })
  })

  describe('usage readers', () => {
    it('summarizes daily usage rows with date and dimension filters', async () => {
      mockPrisma.providerUsageDaily.findMany.mockResolvedValue([
        {
          costUsd: decimal(0.5),
          errorCount: 1,
          inputTokens: 100,
          outputTokens: 50,
          requestCount: 3,
          runCount: 2,
        },
        {
          costUsd: decimal(1.25),
          errorCount: 0,
          inputTokens: 10,
          outputTokens: 20,
          requestCount: 4,
          runCount: 1,
        },
      ])

      const summary = await getProviderUsageSummary({
        from: new Date('2026-05-17T12:00:00.000Z'),
        modelId: ' gpt-5.5 ',
        providerId: 'openai',
        to: new Date('2026-05-19T23:00:00.000Z'),
        userId: 'u1',
      })

      expect(mockPrisma.providerUsageDaily.findMany).toHaveBeenCalledWith({
        where: {
          bucketDate: {
            gte: new Date('2026-05-17T00:00:00.000Z'),
            lte: new Date('2026-05-19T00:00:00.000Z'),
          },
          modelId: 'gpt-5.5',
          providerId: 'openai',
          userId: 'u1',
        },
        select: {
          costUsd: true,
          errorCount: true,
          inputTokens: true,
          outputTokens: true,
          requestCount: true,
          runCount: true,
        },
      })
      expect(summary).toEqual({
        costUsd: 1.75,
        errorCount: 1,
        inputTokens: 110,
        outputTokens: 70,
        requestCount: 7,
        runCount: 3,
      })
    })

    it('groups usage rows by user and sorts by request volume', async () => {
      const alice = { id: 'u1', email: 'alice@example.com', slug: 'alice' }
      const bob = { id: 'u2', email: 'bob@example.com', slug: 'bob' }
      mockPrisma.providerUsageDaily.findMany.mockResolvedValue([
        {
          costUsd: decimal(0.5),
          errorCount: 0,
          inputTokens: 10,
          outputTokens: 20,
          requestCount: 2,
          runCount: 1,
          user: alice,
          userId: 'u1',
        },
        {
          costUsd: decimal(2),
          errorCount: 1,
          inputTokens: 30,
          outputTokens: 40,
          requestCount: 8,
          runCount: 3,
          user: bob,
          userId: 'u2',
        },
        {
          costUsd: decimal(0.75),
          errorCount: 2,
          inputTokens: 5,
          outputTokens: 6,
          requestCount: 4,
          runCount: 1,
          user: alice,
          userId: 'u1',
        },
      ])

      await expect(listProviderUsageUsers({ providerId: 'openai' })).resolves.toEqual([
        {
          costUsd: 2,
          errorCount: 1,
          inputTokens: 30,
          outputTokens: 40,
          requestCount: 8,
          runCount: 3,
          user: bob,
          userId: 'u2',
        },
        {
          costUsd: 1.25,
          errorCount: 2,
          inputTokens: 15,
          outputTokens: 26,
          requestCount: 6,
          runCount: 2,
          user: alice,
          userId: 'u1',
        },
      ])
      expect(mockPrisma.providerUsageDaily.findMany).toHaveBeenCalledWith({
        include: { user: { select: { email: true, id: true, slug: true } } },
        where: { providerId: 'openai' },
      })
    })

    it('groups usage rows by provider, model, source, and credential source', async () => {
      mockPrisma.providerUsageDaily.findMany.mockResolvedValue([
        {
          costUsd: decimal(0.5),
          credentialSource: 'user',
          errorCount: 0,
          inputTokens: 10,
          modelId: 'gpt-5.5',
          outputTokens: 20,
          providerId: 'openai',
          requestCount: 2,
          runCount: 1,
          source: 'web',
        },
        {
          costUsd: decimal(1),
          credentialSource: 'user',
          errorCount: 1,
          inputTokens: 5,
          modelId: 'gpt-5.5',
          outputTokens: 6,
          providerId: 'openai',
          requestCount: 10,
          runCount: 3,
          source: 'web',
        },
        {
          costUsd: decimal(0.25),
          credentialSource: 'organization',
          errorCount: 0,
          inputTokens: 1,
          modelId: 'claude',
          outputTokens: 2,
          providerId: 'anthropic',
          requestCount: 1,
          runCount: 1,
          source: 'gateway',
        },
      ])

      await expect(listProviderUsageProviders({ userId: 'u1' })).resolves.toEqual([
        {
          costUsd: 1.5,
          credentialSource: 'user',
          errorCount: 1,
          inputTokens: 15,
          modelId: 'gpt-5.5',
          outputTokens: 26,
          providerId: 'openai',
          requestCount: 12,
          runCount: 4,
          source: 'web',
        },
        {
          costUsd: 0.25,
          credentialSource: 'organization',
          errorCount: 0,
          inputTokens: 1,
          modelId: 'claude',
          outputTokens: 2,
          providerId: 'anthropic',
          requestCount: 1,
          runCount: 1,
          source: 'gateway',
        },
      ])
      expect(mockPrisma.providerUsageDaily.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    })
  })
})
