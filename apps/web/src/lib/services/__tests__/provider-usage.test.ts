import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  providerUsageDaily: {
    upsert: vi.fn(),
  },
  providerUsageRun: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  recordProviderGatewayRequest,
  recordProviderRunUsage,
} from '../provider-usage'

describe('providerUsageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations))
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
  })
})
