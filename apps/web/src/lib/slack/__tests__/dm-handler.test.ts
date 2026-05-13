import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  handleNewSlackDmCommand,
  handleSlackDmDecisionAction,
  handleSlackDmEvent,
} from '@/lib/slack/dm-handler'
import type {
  SlackChatClient,
  SlackCommandBody,
  SlackCommandRespond,
  SlackMessageEvent,
} from '@/lib/slack/socket-types'

const mocks = vi.hoisted(() => ({
  auditService: {
    createEvent: vi.fn(),
  },
  opencode: {
    createInstanceClient: vi.fn(),
  },
  sessionExecution: {
    captureSessionMessageCursor: vi.fn(),
    ensureWorkspaceRunningForExecution: vi.fn(),
    readLatestAssistantText: vi.fn(),
    waitForSessionToComplete: vi.fn(),
  },
  slackService: {
    createDmSessionBinding: vi.fn(),
    createPendingDmDecision: vi.fn(),
    expirePendingDmDecision: vi.fn(),
    findDmSessionBindingById: vi.fn(),
    findLatestDmSession: vi.fn(),
    findPendingDmDecision: vi.fn(),
    markLastError: vi.fn(),
    markPendingDmDecisionContinued: vi.fn(),
    markPendingDmDecisionStartedNew: vi.fn(),
    resolveArcheUserFromSlackUser: vi.fn(),
    touchDmSessionBinding: vi.fn(),
  },
  socketUtils: {
    buildSlackDmDecisionBlocks: vi.fn((decisionId: string) => [{ decisionId }]),
    buildSlackDmSessionTitle: vi.fn(() => 'Slack DM | Alice'),
    finalizeSlackDmReply: vi.fn(),
    getSlackActionContext: vi.fn(),
    getSlackActionTarget: vi.fn(),
    getSlackActionValue: vi.fn(),
    isSlackDmCommand: vi.fn(),
    loadSlackUserProfile: vi.fn(),
    mapSlackFailureToMessage: vi.fn((failure: string) => `mapped:${failure}`),
    mapSlackUserResolutionError: vi.fn((error: string) => `resolution:${error}`),
    postSlackDmMessage: vi.fn(),
    postSlackDmPlaceholder: vi.fn(),
    resolveConfiguredSlackAgentId: vi.fn(),
    resolveSlackTeamId: vi.fn(),
    updateSlackActionMessage: vi.fn(),
  },
  userService: {
    findByIdSelect: vi.fn(),
  },
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: (...args: unknown[]) => mocks.opencode.createInstanceClient(...args),
}))

vi.mock('@/lib/opencode/session-execution', () => ({
  captureSessionMessageCursor: (...args: unknown[]) => mocks.sessionExecution.captureSessionMessageCursor(...args),
  ensureWorkspaceRunningForExecution: (...args: unknown[]) => mocks.sessionExecution.ensureWorkspaceRunningForExecution(...args),
  readLatestAssistantText: (...args: unknown[]) => mocks.sessionExecution.readLatestAssistantText(...args),
  waitForSessionToComplete: (...args: unknown[]) => mocks.sessionExecution.waitForSessionToComplete(...args),
}))

vi.mock('@/lib/services', () => ({
  auditService: mocks.auditService,
  slackService: mocks.slackService,
  userService: mocks.userService,
}))

vi.mock('@/lib/slack/socket-utils', () => mocks.socketUtils)

function createClient(): SlackChatClient {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    conversations: {
      history: vi.fn().mockResolvedValue({}),
      replies: vi.fn().mockResolvedValue({}),
    },
    users: {
      info: vi.fn().mockResolvedValue({}),
    },
  }
}

function messageEvent(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    channel: 'D123',
    channel_type: 'im',
    text: 'Hello',
    ts: '1000.0001',
    user: 'U123',
    ...overrides,
  }
}

function commandBody(overrides: Partial<SlackCommandBody> = {}): SlackCommandBody {
  return {
    channel_id: 'D123',
    channel_name: 'directmessage',
    team_id: 'T123',
    text: 'Hello',
    user_id: 'U123',
    ...overrides,
  }
}

function pendingDecision(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'D123',
    expiresAt: new Date(Date.now() + 60_000),
    id: 'decision-1',
    messageText: 'Hello again',
    previousDmSessionBindingId: 'binding-1',
    slackTeamId: 'T123',
    slackUserId: 'U123',
    status: 'pending',
    ...overrides,
  }
}

describe('Slack DM handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.socketUtils.resolveSlackTeamId.mockResolvedValue('T123')
    mocks.socketUtils.loadSlackUserProfile.mockResolvedValue({ displayName: 'Alice', email: 'alice@test.com' })
    mocks.socketUtils.getSlackActionContext.mockReturnValue({
      channelId: 'D123',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    mocks.socketUtils.getSlackActionTarget.mockReturnValue({ channelId: 'D123', messageTs: '1000.0001' })
    mocks.socketUtils.getSlackActionValue.mockReturnValue('decision-1')
    mocks.socketUtils.postSlackDmMessage.mockResolvedValue(undefined)
    mocks.socketUtils.postSlackDmPlaceholder.mockResolvedValue('placeholder-ts')
    mocks.socketUtils.updateSlackActionMessage.mockResolvedValue(undefined)
    mocks.slackService.markLastError.mockResolvedValue(undefined)
    mocks.slackService.resolveArcheUserFromSlackUser.mockResolvedValue({
      ok: true,
      user: { id: 'user-1', slug: 'alice' },
    })
    mocks.slackService.findLatestDmSession.mockResolvedValue(null)
    mocks.slackService.createPendingDmDecision.mockResolvedValue({ id: 'decision-1' })
    mocks.slackService.expirePendingDmDecision.mockResolvedValue(undefined)
  })

  it('ignores malformed DM events before resolving Slack state', async () => {
    await handleSlackDmEvent({
      body: {},
      client: createClient(),
      event: messageEvent({ text: '   ' }),
      eventId: 'Ev1',
    })

    expect(mocks.socketUtils.resolveSlackTeamId).not.toHaveBeenCalled()
  })

  it('notifies the user when the Slack team cannot be resolved', async () => {
    const client = createClient()
    mocks.socketUtils.resolveSlackTeamId.mockResolvedValue(null)

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.socketUtils.postSlackDmMessage).toHaveBeenCalledWith(
      client,
      'D123',
      'I could not identify the Slack workspace to link your account.',
    )
  })

  it('maps Slack user resolution failures in DMs', async () => {
    const client = createClient()
    mocks.slackService.resolveArcheUserFromSlackUser.mockResolvedValue({ ok: false, error: 'slack_email_missing' })

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.socketUtils.postSlackDmMessage).toHaveBeenCalledWith(
      client,
      'D123',
      'resolution:slack_email_missing',
    )
  })

  it('prompts for a continue-or-new decision for stale but recent DMs', async () => {
    const client = createClient()
    mocks.slackService.findLatestDmSession.mockResolvedValue({
      id: 'binding-1',
      lastMessageAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    })

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.slackService.createPendingDmDecision).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'D123',
      messageText: 'Hello',
      previousDmSessionBindingId: 'binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'Ev1',
      sourceTs: '1000.0001',
    }))
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      blocks: [{ decisionId: 'decision-1' }],
      channel: 'D123',
      text: 'More than 2 hours have passed since the last conversation. Do you want to continue the previous conversation or start a new one?',
    })
  })

  it('responds to malformed and non-DM /new commands', async () => {
    const respond: SlackCommandRespond = vi.fn().mockResolvedValue({})

    await handleNewSlackDmCommand({ body: null, client: createClient(), respond })
    expect(respond).toHaveBeenCalledWith({ text: 'I could not interpret the /new command.' })

    mocks.socketUtils.isSlackDmCommand.mockReturnValue(false)
    await handleNewSlackDmCommand({ body: commandBody(), client: createClient(), respond })
    expect(respond).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: '/new is intended for Arche DMs. For channels, mention Arche in a thread.',
    })
  })

  it('reports Slack team and user resolution failures for /new', async () => {
    const respond: SlackCommandRespond = vi.fn().mockResolvedValue({})
    mocks.socketUtils.isSlackDmCommand.mockReturnValue(true)
    mocks.socketUtils.resolveSlackTeamId.mockResolvedValueOnce(null)

    await handleNewSlackDmCommand({ body: commandBody(), client: createClient(), respond })
    expect(respond).toHaveBeenCalledWith({ text: 'I could not identify the Slack workspace to link your account.' })

    mocks.socketUtils.resolveSlackTeamId.mockResolvedValue('T123')
    mocks.slackService.resolveArcheUserFromSlackUser.mockResolvedValue({ ok: false, error: 'slack_email_missing' })
    await handleNewSlackDmCommand({ body: commandBody(), client: createClient(), respond })
    expect(respond).toHaveBeenCalledWith({ text: 'resolution:slack_email_missing' })
  })

  it('rejects missing or invalid DM decisions', async () => {
    const client = createClient()
    mocks.socketUtils.getSlackActionValue.mockReturnValueOnce(null)

    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision is no longer valid.',
    )

    mocks.slackService.findPendingDmDecision.mockResolvedValue(null)
    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenLastCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision is no longer valid.',
    )
  })

  it('rejects decisions with mismatched context or expired timestamps', async () => {
    const client = createClient()
    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision())
    mocks.socketUtils.getSlackActionContext.mockReturnValueOnce({
      channelId: 'D999',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })

    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision is no longer valid.',
    )

    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision({ expiresAt: new Date(Date.now() - 1) }))
    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.slackService.expirePendingDmDecision).toHaveBeenCalledWith('decision-1')
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenLastCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision expired. Send your message again to continue.',
    )
  })

  it('handles continue decisions when the previous conversation cannot be used', async () => {
    const client = createClient()
    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision({ previousDmSessionBindingId: null }))

    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'I could not find the previous conversation. Send your message again to start over.',
    )

    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision())
    mocks.slackService.findDmSessionBindingById.mockResolvedValueOnce(null)
    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.slackService.expirePendingDmDecision).toHaveBeenLastCalledWith('decision-1')

    mocks.slackService.findDmSessionBindingById.mockResolvedValue({
      executionUserId: 'user-1',
      id: 'binding-1',
      openCodeSessionId: 'session-1',
    })
    mocks.slackService.markPendingDmDecisionContinued.mockResolvedValueOnce(false)
    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenLastCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision is no longer valid.',
    )

    mocks.slackService.markPendingDmDecisionContinued.mockResolvedValue(true)
    mocks.userService.findByIdSelect.mockResolvedValue(null)
    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenLastCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'I could not find the linked Arche account.',
    )
  })

  it('handles start-new decisions that cannot be claimed or resolved', async () => {
    const client = createClient()
    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision())
    mocks.slackService.markPendingDmDecisionStartedNew.mockResolvedValueOnce(false)

    await handleSlackDmDecisionAction({ action: 'start_new', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'This decision is no longer valid.',
    )

    mocks.slackService.markPendingDmDecisionStartedNew.mockResolvedValue(true)
    mocks.slackService.resolveArcheUserFromSlackUser.mockResolvedValue({ ok: false, error: 'slack_email_missing' })
    await handleSlackDmDecisionAction({ action: 'start_new', body: {}, client })
    expect(mocks.socketUtils.updateSlackActionMessage).toHaveBeenLastCalledWith(
      client,
      { channelId: 'D123', messageTs: '1000.0001' },
      'resolution:slack_email_missing',
    )
  })
})
