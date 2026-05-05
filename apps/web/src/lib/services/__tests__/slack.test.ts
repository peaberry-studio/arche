import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  externalIntegration: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  slackEventReceipt: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  slackThreadBinding: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const { mockEncryptConfig, mockDecryptConfig } = vi.hoisted(() => ({
  mockEncryptConfig: vi.fn((v: unknown) => JSON.stringify(v)),
  mockDecryptConfig: vi.fn((v: string) => JSON.parse(v)),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/connectors/crypto', () => ({
  encryptConfig: mockEncryptConfig,
  decryptConfig: mockDecryptConfig,
}))

import {
  SLACK_INTEGRATION_KEY,
  findIntegration,
  saveIntegrationConfig,
  clearIntegration,
  markSocketConnected,
  markEventReceived,
  markLastError,
  hasEventReceipt,
  recordEventReceipt,
  pruneEventReceipts,
  findThreadBinding,
  upsertThreadBinding,
} from '../slack'

const NOW = new Date('2026-04-25T12:00:00Z')

function makeRow(config: Record<string, unknown> = {}, state: Record<string, unknown> = {}) {
  return {
    key: SLACK_INTEGRATION_KEY,
    config: JSON.stringify(config),
    state,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('slackService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findIntegration', () => {
    it('returns null when no row exists', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(null)
      const result = await findIntegration()
      expect(result).toBeNull()
      expect(mockPrisma.externalIntegration.findUnique).toHaveBeenCalledWith({
        where: { key: SLACK_INTEGRATION_KEY },
      })
    })

    it('returns decrypted integration record when row exists', async () => {
      const row = makeRow(
        { enabled: true, botTokenSecret: 'xoxb-secret', appTokenSecret: 'xapp-secret', defaultAgentId: 'a1' },
        { slackTeamId: 'T1', slackAppId: 'A1', slackBotUserId: 'U1', lastError: null, lastSocketConnectedAt: null, lastEventAt: null },
      )
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(row)

      const result = await findIntegration()
      expect(result).not.toBeNull()
      expect(result!.enabled).toBe(true)
      expect(result!.botTokenSecret).toBe('xoxb-secret')
      expect(result!.slackTeamId).toBe('T1')
    })

    it('handles invalid serialized state and corrupted config', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockDecryptConfig.mockImplementationOnce(() => { throw new Error('decrypt failed') })
      mockPrisma.externalIntegration.findUnique.mockResolvedValue({
        ...makeRow({}, {}),
        config: 'not-json',
        state: '{',
      })

      const result = await findIntegration()

      expect(result).toMatchObject({
        configCorrupted: true,
        enabled: false,
        lastError: null,
      })
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[slack] Failed to decrypt integration config',
        'decrypt failed',
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('saveIntegrationConfig', () => {
    it('upserts with enabled flag', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(null)
      mockPrisma.externalIntegration.upsert.mockResolvedValue(
        makeRow({ enabled: true }),
      )

      const result = await saveIntegrationConfig({ enabled: true })
      expect(result).not.toBeNull()
      expect(mockPrisma.externalIntegration.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: SLACK_INTEGRATION_KEY },
        }),
      )
    })

    it('includes optional fields when provided', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(null)
      mockPrisma.externalIntegration.upsert.mockResolvedValue(
        makeRow(
          { enabled: true, botTokenSecret: 'xoxb', appTokenSecret: 'xapp', defaultAgentId: 'a1' },
          { slackTeamId: 'T1', slackAppId: 'A1', slackBotUserId: 'U1' },
        ),
      )

      const result = await saveIntegrationConfig({
        enabled: true,
        botTokenSecret: 'xoxb',
        appTokenSecret: 'xapp',
        slackTeamId: 'T1',
        slackAppId: 'A1',
        slackBotUserId: 'U1',
        defaultAgentId: 'a1',
        clearLastError: true,
      })

      expect(result.botTokenSecret).toBe('xoxb')
      expect(result.slackTeamId).toBe('T1')
    })

    it('preserves existing config when fields not provided', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(
        makeRow(
          { enabled: true, botTokenSecret: 'old-bot', appTokenSecret: 'old-app' },
          { slackTeamId: 'T-old' },
        ),
      )
      mockPrisma.externalIntegration.upsert.mockImplementation(async (args: { update: { config: string; state: unknown } }) => ({
        key: SLACK_INTEGRATION_KEY,
        config: args.update.config,
        state: args.update.state,
        version: 2,
        createdAt: NOW,
        updatedAt: NOW,
      }))

      const result = await saveIntegrationConfig({ enabled: false })
      expect(result.botTokenSecret).toBe('old-bot')
    })

    it('falls back to empty existing config and state when stored values are invalid', async () => {
      mockDecryptConfig.mockImplementationOnce(() => { throw new Error('decrypt failed') })
      mockPrisma.externalIntegration.findUnique.mockResolvedValue({
        ...makeRow({}, {}),
        config: 'corrupted',
        state: null,
      })
      mockPrisma.externalIntegration.upsert.mockImplementation(async (args: { update: { config: string; state: unknown } }) => ({
        key: SLACK_INTEGRATION_KEY,
        config: args.update.config,
        state: args.update.state,
        version: 2,
        createdAt: NOW,
        updatedAt: NOW,
      }))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      const result = await saveIntegrationConfig({ enabled: true })

      expect(result.enabled).toBe(true)
      expect(result.botTokenSecret).toBeNull()
    })
  })

  describe('clearIntegration', () => {
    it('resets config to disabled', async () => {
      mockPrisma.externalIntegration.upsert.mockResolvedValue(
        makeRow({ enabled: false }),
      )
      const result = await clearIntegration()
      expect(result.enabled).toBe(false)
    })
  })

  describe('markSocketConnected', () => {
    it('updates state with connectedAt and clears lastError', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(
        makeRow({}, { lastError: 'old error' }),
      )
      mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
      const date = new Date('2026-04-25T10:00:00Z')
      await markSocketConnected(date)
      expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
        where: { key: SLACK_INTEGRATION_KEY },
        data: expect.objectContaining({
          state: expect.objectContaining({
            lastSocketConnectedAt: date.toISOString(),
            lastError: null,
          }),
        }),
      })
    })
  })

  describe('markEventReceived', () => {
    it('updates state with lastEventAt', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow())
      mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
      const date = new Date('2026-04-25T10:00:00Z')
      await markEventReceived(date)
      expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
        where: { key: SLACK_INTEGRATION_KEY },
        data: expect.objectContaining({
          state: expect.objectContaining({
            lastEventAt: date.toISOString(),
          }),
        }),
      })
    })
  })

  describe('markLastError', () => {
    it('sets the error message', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow())
      mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
      await markLastError('socket timeout')
      expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
        where: { key: SLACK_INTEGRATION_KEY },
        data: expect.objectContaining({
          state: expect.objectContaining({ lastError: 'socket timeout' }),
        }),
      })
    })

    it('clears the error when null', async () => {
      mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow())
      mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
      await markLastError(null)
      expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
        where: { key: SLACK_INTEGRATION_KEY },
        data: expect.objectContaining({
          state: expect.objectContaining({ lastError: null }),
        }),
      })
    })
  })

  describe('hasEventReceipt', () => {
    it('returns true when receipt exists', async () => {
      mockPrisma.slackEventReceipt.findUnique.mockResolvedValue({ id: 'r1' })
      expect(await hasEventReceipt('evt-1')).toBe(true)
    })

    it('returns false when receipt does not exist', async () => {
      mockPrisma.slackEventReceipt.findUnique.mockResolvedValue(null)
      expect(await hasEventReceipt('evt-1')).toBe(false)
    })
  })

  describe('recordEventReceipt', () => {
    it('creates receipt and returns true', async () => {
      mockPrisma.slackEventReceipt.create.mockResolvedValue({})
      const result = await recordEventReceipt({
        eventId: 'evt-1',
        type: 'message',
        receivedAt: new Date(),
      })
      expect(result).toBe(true)
    })

    it('returns false on unique constraint violation (P2002)', async () => {
      mockPrisma.slackEventReceipt.create.mockRejectedValue({ code: 'P2002' })
      const result = await recordEventReceipt({
        eventId: 'evt-1',
        type: 'message',
        receivedAt: new Date(),
      })
      expect(result).toBe(false)
    })

    it('rethrows non-unique-constraint errors', async () => {
      const error = new Error('db down')
      mockPrisma.slackEventReceipt.create.mockRejectedValue(error)
      await expect(
        recordEventReceipt({ eventId: 'evt-1', type: 'message', receivedAt: new Date() }),
      ).rejects.toThrow('db down')
    })
  })

  describe('pruneEventReceipts', () => {
    it('deletes receipts older than the given date', async () => {
      mockPrisma.slackEventReceipt.deleteMany.mockResolvedValue({ count: 5 })
      const cutoff = new Date('2026-04-20T00:00:00Z')
      await pruneEventReceipts(cutoff)
      expect(mockPrisma.slackEventReceipt.deleteMany).toHaveBeenCalledWith({
        where: { receivedAt: { lt: cutoff } },
      })
    })
  })

  describe('findThreadBinding', () => {
    it('queries by composite key', async () => {
      mockPrisma.slackThreadBinding.findUnique.mockResolvedValue(null)
      await findThreadBinding('C123', '1234567890.123456')
      expect(mockPrisma.slackThreadBinding.findUnique).toHaveBeenCalledWith({
        where: {
          channelId_threadTs: { channelId: 'C123', threadTs: '1234567890.123456' },
        },
      })
    })
  })

  describe('upsertThreadBinding', () => {
    it('creates or updates thread binding', async () => {
      const args = {
        channelId: 'C123',
        threadTs: '1234567890.123456',
        openCodeSessionId: 'session-1',
        executionUserId: 'u1',
      }
      mockPrisma.slackThreadBinding.upsert.mockResolvedValue(args)
      await upsertThreadBinding(args)
      expect(mockPrisma.slackThreadBinding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            channelId_threadTs: { channelId: 'C123', threadTs: '1234567890.123456' },
          },
          create: args,
          update: {
            openCodeSessionId: 'session-1',
            executionUserId: 'u1',
          },
        }),
      )
    })
  })
})
