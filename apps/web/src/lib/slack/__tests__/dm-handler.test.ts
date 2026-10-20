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
  isArchivedSession: vi.fn(),
  auditService: {
    createEvent: vi.fn(),
  },
  opencode: {
    getRuntimeForSlug: vi.fn(),
  },
  sessionExecution: {
    captureSessionMessageCursor: vi.fn(),
    createSessionPromptRun: vi.fn(),
    EXECUTION_TERMINATION_UNCONFIRMED_ERROR: 'execution_termination_unconfirmed',
    ensureWorkspaceRunningForExecution: vi.fn(),
    readLatestAssistantText: vi.fn(),
    waitForSessionToComplete: vi.fn(),
  },
  messageRunService: {
    markRunFailed: vi.fn(),
    markRunSucceeded: vi.fn(),
  },
  slackService: {
    createDmSessionBinding: vi.fn(),
    createPendingDmDecision: vi.fn(),
    deleteSessionBindingsByOpenCodeSessionId: vi.fn(),
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

vi.mock('@/lib/harness/registry', () => ({
  getRuntimeForSlug: (...args: unknown[]) => mocks.opencode.getRuntimeForSlug(...args),
}))

vi.mock('@/lib/harness/execution', () => ({
  captureSessionMessageCursor: (...args: unknown[]) => mocks.sessionExecution.captureSessionMessageCursor(...args),
  createSessionPromptRun: (...args: unknown[]) => mocks.sessionExecution.createSessionPromptRun(...args),
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR: mocks.sessionExecution.EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
  ensureWorkspaceRunningForExecution: (...args: unknown[]) => mocks.sessionExecution.ensureWorkspaceRunningForExecution(...args),
  readLatestAssistantText: (...args: unknown[]) => mocks.sessionExecution.readLatestAssistantText(...args),
  waitForSessionToComplete: (...args: unknown[]) => mocks.sessionExecution.waitForSessionToComplete(...args),
}))

vi.mock('@/lib/services', () => ({
  auditService: mocks.auditService,
  messageRunService: mocks.messageRunService,
  slackService: mocks.slackService,
  userService: mocks.userService,
}))

vi.mock('@/lib/slack/socket-utils', () => mocks.socketUtils)
vi.mock('@/lib/services/legacy-session-archive', () => ({ isArchivedSession: mocks.isArchivedSession }))

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
    mocks.isArchivedSession.mockResolvedValue(false)
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
    mocks.sessionExecution.createSessionPromptRun.mockResolvedValue({
      ok: true,
      run: { id: 'run-1' },
    })
    mocks.sessionExecution.waitForSessionToComplete.mockResolvedValue({ status: 'completed' })
    mocks.messageRunService.markRunFailed.mockResolvedValue(undefined)
    mocks.messageRunService.markRunSucceeded.mockResolvedValue(undefined)
    mocks.slackService.deleteSessionBindingsByOpenCodeSessionId.mockResolvedValue({ dm: 0, thread: 0 })
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

  it('formats and splits DM replies while authorizing only the DM participant mention', async () => {
    const client = createClient()
    mocks.opencode.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      createSession: vi.fn().mockResolvedValue({ ok: true, data: { id: 'session-1' } }),
      prompt: vi.fn().mockResolvedValue({ ok: true }),
    } })
    mocks.slackService.createDmSessionBinding.mockResolvedValue({ id: 'binding-1' })
    mocks.sessionExecution.captureSessionMessageCursor.mockResolvedValue({ messageCount: 0 })
    mocks.sessionExecution.readLatestAssistantText.mockResolvedValue(`**Bold** <@U123> <@U999>\n\n${'x'.repeat(3_501)}`)
    mocks.sessionExecution.waitForSessionToComplete.mockResolvedValue({ status: 'completed' })

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.socketUtils.finalizeSlackDmReply).toHaveBeenCalledWith(
      client,
      'D123',
      'placeholder-ts',
      [
        '*Bold* <@U123> &lt;@U999&gt;',
        'x'.repeat(3_500),
        'x',
      ],
    )
  })

  it('retains the DM message run lock and warns without retrying when termination is unconfirmed', async () => {
    const client = createClient()
    const createSession = vi.fn().mockResolvedValue({ ok: true, data: { id: 'session-1' } })
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    const warning = 'I could not confirm the previous response stopped. It may still be running, so wait a moment before sending another message.'
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.opencode.getRuntimeForSlug.mockResolvedValue({ ok: true, data: { createSession, prompt } })
    mocks.slackService.createDmSessionBinding.mockResolvedValue({ id: 'binding-1' })
    mocks.sessionExecution.captureSessionMessageCursor.mockResolvedValue({ messageCount: 0 })
    mocks.sessionExecution.waitForSessionToComplete.mockResolvedValue({
      status: 'termination_unconfirmed',
      cause: 'flow_run_timeout',
    })
    mocks.socketUtils.mapSlackFailureToMessage.mockReturnValueOnce(warning)

    try {
      await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

      expect(mocks.sessionExecution.createSessionPromptRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        sessionId: 'session-1', slug: 'alice', source: 'slack_dm',
      }))
      expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'session-1' }))
      expect(mocks.sessionExecution.waitForSessionToComplete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        sessionId: 'session-1',
        usage: { messageRunId: 'run-1', source: 'slack_dm', userId: 'user-1' },
      }))
      expect(mocks.messageRunService.markRunFailed).not.toHaveBeenCalled()
      expect(mocks.messageRunService.markRunSucceeded).not.toHaveBeenCalled()
      expect(mocks.sessionExecution.readLatestAssistantText).not.toHaveBeenCalled()
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(mocks.slackService.deleteSessionBindingsByOpenCodeSessionId).not.toHaveBeenCalled()
      expect(mocks.socketUtils.mapSlackFailureToMessage).toHaveBeenCalledExactlyOnceWith('execution_termination_unconfirmed')
      expect(mocks.socketUtils.finalizeSlackDmReply).toHaveBeenCalledExactlyOnceWith(
        client, 'D123', 'placeholder-ts', [warning],
      )
      expect(mocks.socketUtils.postSlackDmMessage).not.toHaveBeenCalled()
      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith('[slack] Runtime termination unconfirmed', { cause: 'flow_run_timeout' })
    } finally {
      consoleWarnSpy.mockRestore()
    }
  })

  it.each([1, 3, 9])('rebinds an archived DM after %i hours without asking to continue it', async (hours) => {
    const client = createClient()
    const getSession = vi.fn()
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    mocks.isArchivedSession.mockResolvedValue(true)
    mocks.slackService.findLatestDmSession.mockResolvedValue({
      id: 'legacy-binding',
      openCodeSessionId: 'legacy-session',
      lastMessageAt: new Date(Date.now() - hours * 60 * 60 * 1000),
    })
    mocks.opencode.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      createSession: vi.fn().mockResolvedValue({ ok: true, data: { id: 'live-session' } }),
      getSession,
      prompt,
    } })
    mocks.slackService.createDmSessionBinding.mockResolvedValue({ id: 'live-binding' })
    mocks.sessionExecution.readLatestAssistantText.mockResolvedValue('Recovered reply')

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.isArchivedSession).toHaveBeenCalledWith('alice', 'legacy-session')
    expect(getSession).not.toHaveBeenCalled()
    expect(mocks.slackService.createPendingDmDecision).not.toHaveBeenCalled()
    expect(mocks.slackService.deleteSessionBindingsByOpenCodeSessionId).not.toHaveBeenCalled()
    expect(mocks.slackService.createDmSessionBinding).toHaveBeenCalledWith({
      channelId: 'D123', executionUserId: 'user-1', openCodeSessionId: 'live-session', slackTeamId: 'T123', slackUserId: 'U123',
    })
    expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'live-session' }))
    expect(mocks.slackService.touchDmSessionBinding).toHaveBeenCalledWith('live-binding', expect.any(Date))
  })

  it.each([false, true])('checks archive state again after starting a workspace (migrated=%s)', async (migrated) => {
    const client = createClient()
    const getSession = vi.fn().mockResolvedValue({ ok: true, data: { id: 'legacy-session' } })
    const createSession = vi.fn().mockResolvedValue({ ok: true, data: { id: 'live-session' } })
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    mocks.isArchivedSession.mockResolvedValueOnce(false).mockResolvedValue(migrated)
    mocks.slackService.findLatestDmSession.mockResolvedValue({
      executionUserId: 'user-1', id: 'legacy-binding', openCodeSessionId: 'legacy-session', lastMessageAt: new Date(),
    })
    mocks.opencode.getRuntimeForSlug.mockResolvedValue({ ok: true, data: { createSession, getSession, prompt } })
    mocks.slackService.createDmSessionBinding.mockResolvedValue({ id: 'live-binding' })
    mocks.sessionExecution.readLatestAssistantText.mockResolvedValue('Reply')

    await handleSlackDmEvent({ body: {}, client, event: messageEvent(), eventId: 'Ev1' })

    expect(mocks.isArchivedSession).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: migrated ? 'live-session' : 'legacy-session' }))
    expect(createSession).toHaveBeenCalledTimes(migrated ? 1 : 0)
    expect(getSession).toHaveBeenCalledTimes(migrated ? 0 : 1)
    expect(mocks.slackService.deleteSessionBindingsByOpenCodeSessionId).not.toHaveBeenCalled()
  })

  it('recovers a continue decision made before its DM session was archived', async () => {
    const client = createClient()
    const getSession = vi.fn()
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    mocks.isArchivedSession.mockResolvedValue(true)
    mocks.slackService.findPendingDmDecision.mockResolvedValue(pendingDecision())
    mocks.slackService.findDmSessionBindingById.mockResolvedValue({ executionUserId: 'user-1', id: 'binding-1', openCodeSessionId: 'legacy-session' })
    mocks.slackService.markPendingDmDecisionContinued.mockResolvedValue(true)
    mocks.userService.findByIdSelect.mockResolvedValue({ slug: 'alice' })
    mocks.slackService.createDmSessionBinding.mockResolvedValue({ id: 'live-binding' })
    mocks.opencode.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      createSession: vi.fn().mockResolvedValue({ ok: true, data: { id: 'live-session' } }), getSession, prompt,
    } })
    mocks.sessionExecution.readLatestAssistantText.mockResolvedValue('Reply')

    await handleSlackDmDecisionAction({ action: 'continue', body: {}, client })

    expect(getSession).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: 'live-session' }))
    expect(mocks.slackService.touchDmSessionBinding).toHaveBeenCalledWith('live-binding', expect.any(Date))
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
