import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
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
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  slackUserLink: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  slackDmSessionBinding: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  slackPendingDmDecision: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  slackNotificationChannel: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
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
  clearIntegration,
  createDmSessionBinding,
  createPendingDmDecision,
  deleteSessionBindingsByOpenCodeSessionId,
  expirePendingDmDecision,
  findDmSessionBindingById,
  findIntegration,
  findLatestDmSession,
  findPendingDmDecision,
  findThreadBinding,
  findUserLinkBySlackUser,
  hasEventReceipt,
  isNotificationChannelAllowed,
  listEnabledNotificationChannels,
  listNotificationChannels,
  markEventReceived,
  markLastError,
  markPendingDmDecisionContinued,
  markPendingDmDecisionStartedNew,
  markSocketConnected,
  pruneEventReceipts,
  recordEventReceipt,
  resolveArcheUserFromSlackUser,
  saveIntegrationConfig,
  setNotificationChannelEnabledById,
  touchDmSessionBinding,
  upsertNotificationChannelsFromSlack,
  upsertThreadBinding,
  upsertUserLink,
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

  describe('Slack user links', () => {
    it('finds a user link by Slack team and user id', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      await findUserLinkBySlackUser('T123', 'U123')
      expect(mockPrisma.slackUserLink.findUnique).toHaveBeenCalledWith({
        where: {
          slackTeamId_slackUserId: {
            slackTeamId: 'T123',
            slackUserId: 'U123',
          },
        },
      })
    })

    it('creates a Slack user link and audits new links', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.slackUserLink.create.mockResolvedValue({ id: 'link-1' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      await upsertUserLink({
        displayName: 'Alice',
        slackEmail: 'alice@test.com',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })

      expect(mockPrisma.slackUserLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      })
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'slack.user_linked' }),
        }),
      )
    })

    it('rejects Slack user link conflicts without reassigning ownership', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue({ id: 'link-1', userId: 'user-2' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      await expect(upsertUserLink({
        displayName: 'Alice',
        slackEmail: 'alice@test.com',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })).rejects.toThrow('slack_user_link_conflict')

      expect(mockPrisma.slackUserLink.create).not.toHaveBeenCalled()
      expect(mockPrisma.slackUserLink.update).not.toHaveBeenCalled()
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'slack.user_link_conflict' }),
        }),
      )
    })

    it('updates an existing Slack user link for the same owner', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue({ id: 'link-1', userId: 'user-1' })
      mockPrisma.slackUserLink.update.mockResolvedValue({ id: 'link-1' })

      const result = await upsertUserLink({
        displayName: ' Alice ',
        slackEmail: ' alice@test.com ',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })

      expect(result).toEqual({ id: 'link-1' })
      expect(mockPrisma.slackUserLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          displayName: 'Alice',
          slackEmail: 'alice@test.com',
        }),
      })
    })

    it('updates after a concurrent create for the same Slack user link owner', async () => {
      mockPrisma.slackUserLink.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'link-1', userId: 'user-1' })
      mockPrisma.slackUserLink.create.mockRejectedValue({ code: 'P2002' })
      mockPrisma.slackUserLink.update.mockResolvedValue({ id: 'link-1' })

      const result = await upsertUserLink({
        displayName: null,
        slackEmail: null,
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })

      expect(result).toEqual({ id: 'link-1' })
      expect(mockPrisma.slackUserLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          displayName: null,
          slackEmail: null,
        }),
      })
    })

    it('rejects a concurrent create for a different Slack user link owner', async () => {
      mockPrisma.slackUserLink.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'link-1', userId: 'user-2' })
      mockPrisma.slackUserLink.create.mockRejectedValue({ code: 'P2002' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      await expect(upsertUserLink({
        displayName: 'Alice',
        slackEmail: 'alice@test.com',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })).rejects.toThrow('slack_user_link_conflict')

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'slack.user_link_conflict' }),
        }),
      )
    })

    it('rethrows a unique constraint when the conflicting Slack user link cannot be found', async () => {
      const uniqueError = { code: 'P2002' }
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.slackUserLink.create.mockRejectedValue(uniqueError)

      await expect(upsertUserLink({
        displayName: 'Alice',
        slackEmail: 'alice@test.com',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })).rejects.toBe(uniqueError)
    })

    it('rethrows non-unique Slack user link create failures', async () => {
      const dbError = new Error('db down')
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.slackUserLink.create.mockRejectedValue(dbError)

      await expect(upsertUserLink({
        displayName: 'Alice',
        slackEmail: 'alice@test.com',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        userId: 'user-1',
      })).rejects.toBe(dbError)
    })

    it('rejects existing Slack user links to non-human accounts', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue({
        id: 'link-1',
        user: { id: 'agent-1', kind: 'AGENT', slug: 'assistant' },
      })

      const result = await resolveArcheUserFromSlackUser('T123', 'U123', 'bot@test.com', 'Assistant')

      expect(result).toEqual({ ok: false, error: 'slack_user_not_linked_to_human' })
      expect(mockPrisma.slackUserLink.update).not.toHaveBeenCalled()
    })

    it('updates and returns an existing Slack user link to a human account', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue({
        id: 'link-1',
        user: { id: 'user-1', kind: 'HUMAN', slug: 'alice' },
      })
      mockPrisma.slackUserLink.update.mockResolvedValue({ id: 'link-1' })

      const result = await resolveArcheUserFromSlackUser('T123', 'U123', ' alice@test.com ', ' Alice ')

      expect(result).toEqual({ ok: true, user: { id: 'user-1', slug: 'alice' } })
      expect(mockPrisma.slackUserLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          displayName: 'Alice',
          slackEmail: 'alice@test.com',
        }),
      })
    })

    it('returns a helpful error when Slack email is missing', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)

      const result = await resolveArcheUserFromSlackUser('T123', 'U123', ' ', 'Alice')

      expect(result).toEqual({ ok: false, error: 'slack_email_missing' })
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
    })

    it('resolves and links an Arche human user by Slack email', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', slug: 'alice' })
      mockPrisma.slackUserLink.create.mockResolvedValue({ id: 'link-1' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      const result = await resolveArcheUserFromSlackUser('T123', 'U123', 'Alice@Test.com', 'Alice')

      expect(result).toEqual({ ok: true, user: { id: 'user-1', slug: 'alice' } })
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: {
              equals: 'Alice@Test.com',
              mode: 'insensitive',
            },
            kind: 'HUMAN',
          },
        }),
      )
    })

    it('uses a case-insensitive email lookup for Slack user linking', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', slug: 'alice' })
      mockPrisma.slackUserLink.create.mockResolvedValue({ id: 'link-1' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      await resolveArcheUserFromSlackUser('T123', 'U123', 'ALICE@test.com', 'Alice')

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: {
              equals: 'ALICE@test.com',
              mode: 'insensitive',
            },
          }),
        }),
      )
    })

    it('returns a helpful error when Slack email has no Arche match', async () => {
      mockPrisma.slackUserLink.findUnique.mockResolvedValue(null)
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const result = await resolveArcheUserFromSlackUser('T123', 'U123', 'missing@test.com', 'Missing')

      expect(result).toEqual({ ok: false, error: 'slack_email_not_found' })
    })
  })

  describe('DM sessions and pending decisions', () => {
    it('deletes Slack bindings by OpenCode session id', async () => {
      mockPrisma.slackDmSessionBinding.deleteMany.mockResolvedValue({ count: 1 })
      mockPrisma.slackThreadBinding.deleteMany.mockResolvedValue({ count: 2 })

      const result = await deleteSessionBindingsByOpenCodeSessionId('session-1')

      expect(result).toEqual({ dm: 1, thread: 2 })
      expect(mockPrisma.slackDmSessionBinding.deleteMany).toHaveBeenCalledWith({
        where: { openCodeSessionId: 'session-1' },
      })
      expect(mockPrisma.slackThreadBinding.deleteMany).toHaveBeenCalledWith({
        where: { openCodeSessionId: 'session-1' },
      })
      expect(mockPrisma.$transaction).toHaveBeenCalledWith([
        expect.any(Promise),
        expect.any(Promise),
      ])
    })

    it('finds the latest DM session by last message time', async () => {
      mockPrisma.slackDmSessionBinding.findFirst.mockResolvedValue(null)
      await findLatestDmSession('T123', 'U123')
      expect(mockPrisma.slackDmSessionBinding.findFirst).toHaveBeenCalledWith({
        where: { slackTeamId: 'T123', slackUserId: 'U123' },
        orderBy: { lastMessageAt: 'desc' },
      })
    })

    it('finds a DM session binding by id', async () => {
      mockPrisma.slackDmSessionBinding.findUnique.mockResolvedValue({ id: 'binding-1' })

      const result = await findDmSessionBindingById('binding-1')

      expect(result).toEqual({ id: 'binding-1' })
      expect(mockPrisma.slackDmSessionBinding.findUnique).toHaveBeenCalledWith({
        where: { id: 'binding-1' },
      })
    })

    it('creates and audits a DM session binding', async () => {
      const binding = {
        channelId: 'D123',
        executionUserId: 'user-1',
        openCodeSessionId: 'session-1',
        slackTeamId: 'T123',
        slackUserId: 'U123',
      }
      mockPrisma.slackDmSessionBinding.create.mockResolvedValue({ id: 'binding-1', ...binding })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      const result = await createDmSessionBinding(binding)

      expect(result).toEqual({ id: 'binding-1', ...binding })
      expect(mockPrisma.slackDmSessionBinding.create).toHaveBeenCalledWith({ data: binding })
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'slack.dm_session_created',
          actorUserId: 'user-1',
          metadata: expect.objectContaining({ openCodeSessionId: 'session-1' }),
        }),
      })
    })

    it('does not fail DM session creation when audit logging fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mockPrisma.slackDmSessionBinding.create.mockResolvedValue({ id: 'binding-1' })
      mockPrisma.auditEvent.create.mockRejectedValue(new Error('audit down'))

      await expect(createDmSessionBinding({
        channelId: 'D123',
        executionUserId: 'user-1',
        openCodeSessionId: 'session-1',
        slackTeamId: 'T123',
        slackUserId: 'U123',
      })).resolves.toEqual({ id: 'binding-1' })
      expect(warnSpy).toHaveBeenCalledWith(
        '[slack] audit event failed:',
        'slack.dm_session_created',
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('touches DM session binding activity time', async () => {
      mockPrisma.slackDmSessionBinding.update.mockResolvedValue({})
      const lastMessageAt = new Date('2026-04-25T13:00:00Z')

      await touchDmSessionBinding('binding-1', lastMessageAt)

      expect(mockPrisma.slackDmSessionBinding.update).toHaveBeenCalledWith({
        where: { id: 'binding-1' },
        data: { lastMessageAt },
      })
    })

    it('creates and finds pending DM decisions', async () => {
      const expiresAt = new Date('2026-04-25T12:30:00Z')
      mockPrisma.slackPendingDmDecision.create.mockResolvedValue({ id: 'decision-1' })
      mockPrisma.slackPendingDmDecision.findUnique.mockResolvedValue({ id: 'decision-1' })

      await findPendingDmDecision('decision-1')
      expect(mockPrisma.slackPendingDmDecision.findUnique).toHaveBeenCalledWith({ where: { id: 'decision-1' } })

      await createPendingDmDecision({
        channelId: 'D123',
        expiresAt,
        messageText: 'hello',
        previousDmSessionBindingId: 'binding-1',
        slackTeamId: 'T123',
        slackUserId: 'U123',
        sourceEventId: 'evt-1',
        sourceTs: '100.1',
      })
      expect(mockPrisma.slackPendingDmDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceEventId: 'evt-1' }),
      })
    })

    it('marks pending DM decisions as continued or started new only when updated', async () => {
      mockPrisma.slackPendingDmDecision.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      await expect(markPendingDmDecisionContinued('decision-1')).resolves.toBe(true)
      await expect(markPendingDmDecisionStartedNew('decision-2')).resolves.toBe(false)

      expect(mockPrisma.slackPendingDmDecision.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          expiresAt: { gt: expect.any(Date) },
          id: 'decision-1',
          status: 'pending',
        },
        data: { messageText: '', status: 'continued' },
      })
      expect(mockPrisma.slackPendingDmDecision.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          expiresAt: { gt: expect.any(Date) },
          id: 'decision-2',
          status: 'pending',
        },
        data: { messageText: '', status: 'started_new' },
      })
    })

    it('expires a pending DM decision', async () => {
      mockPrisma.slackPendingDmDecision.updateMany.mockResolvedValue({ count: 1 })

      await expirePendingDmDecision('decision-1')

      expect(mockPrisma.slackPendingDmDecision.updateMany).toHaveBeenCalledWith({
        where: { id: 'decision-1', status: 'pending' },
        data: { messageText: '', status: 'expired' },
      })
    })
  })

  describe('notification channels', () => {
    it('upserts notification channels without disabling existing entries', async () => {
      mockPrisma.slackNotificationChannel.upsert.mockResolvedValue({})
      await upsertNotificationChannelsFromSlack('T123', [
        { channelId: 'C1', isPrivate: false, name: 'general' },
      ])

      expect(mockPrisma.$transaction).toHaveBeenCalledWith([expect.any(Promise)])
      expect(mockPrisma.slackNotificationChannel.upsert).toHaveBeenCalledWith({
        where: {
          slackTeamId_channelId: {
            channelId: 'C1',
            slackTeamId: 'T123',
          },
        },
        create: expect.objectContaining({ enabled: true, name: 'general' }),
        update: {
          isPrivate: false,
          name: 'general',
        },
      })
    })

    it('lists notification channels by team with stable ordering', async () => {
      mockPrisma.slackNotificationChannel.findMany.mockResolvedValue([])

      await listNotificationChannels('T123')

      expect(mockPrisma.slackNotificationChannel.findMany).toHaveBeenCalledWith({
        where: { slackTeamId: 'T123' },
        orderBy: [
          { isPrivate: 'asc' },
          { name: 'asc' },
        ],
      })
    })

    it('lists enabled notification channels by team with stable ordering', async () => {
      mockPrisma.slackNotificationChannel.findMany.mockResolvedValue([])

      await listEnabledNotificationChannels('T123')

      expect(mockPrisma.slackNotificationChannel.findMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          slackTeamId: 'T123',
        },
        orderBy: [
          { isPrivate: 'asc' },
          { name: 'asc' },
        ],
      })
    })

    it('updates notification channels by database id only', async () => {
      mockPrisma.slackNotificationChannel.updateMany.mockResolvedValue({ count: 1 })

      await setNotificationChannelEnabledById('row-1', false)

      expect(mockPrisma.slackNotificationChannel.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { enabled: false },
      })
    })

    it('checks whether a notification channel is enabled', async () => {
      mockPrisma.slackNotificationChannel.findFirst
        .mockResolvedValueOnce({ id: 'row-1' })
        .mockResolvedValueOnce(null)

      await expect(isNotificationChannelAllowed('T123', 'C1')).resolves.toBe(true)
      await expect(isNotificationChannelAllowed('T123', 'C2')).resolves.toBe(false)

      expect(mockPrisma.slackNotificationChannel.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          channelId: 'C1',
          enabled: true,
          slackTeamId: 'T123',
        },
        select: { id: true },
      })
    })
  })
})
