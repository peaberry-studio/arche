import { beforeEach, describe, expect, it, vi } from 'vitest'

type ReadLatestAssistantTextFn = typeof import('@/lib/opencode/session-execution').readLatestAssistantText

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
}

function createSlackClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    conversations: {
      history: vi.fn().mockResolvedValue({ messages: [] }),
      replies: vi.fn().mockResolvedValue({ messages: [] }),
    },
    users: {
      info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
    },
  }
}

const appConstructorMock = vi.fn()
let nextAppStartImplementation: (() => Promise<void>) | null = null
const appInstances: Array<{
  action: ReturnType<typeof vi.fn>
  command: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  event: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}> = []

const loadSlackAgentOptionsMock = vi.fn()
const buildSlackContextMock = vi.fn()
const buildSlackPromptMock = vi.fn()
const captureSessionMessageCursorMock = vi.fn()
const createInstanceClientMock = vi.fn()
const ensureSlackServiceUserMock = vi.fn()
const ensureWorkspaceRunningForExecutionMock = vi.fn()
const findIntegrationMock = vi.fn()
const findLatestDmSessionMock = vi.fn()
const findPendingDmDecisionMock = vi.fn()
const createDmSessionBindingMock = vi.fn()
const createPendingDmDecisionMock = vi.fn()
const deleteSessionBindingsByOpenCodeSessionIdMock = vi.fn()
const markPendingDmDecisionContinuedMock = vi.fn()
const markPendingDmDecisionStartedNewMock = vi.fn()
const expirePendingDmDecisionMock = vi.fn()
const resolveArcheUserFromSlackUserMock = vi.fn()
const touchDmSessionBindingMock = vi.fn()
const findDmSessionBindingByIdMock = vi.fn()
const createAuditEventMock = vi.fn()
const findByIdSelectMock = vi.fn()
const hasEventReceiptMock = vi.fn()
const findThreadBindingMock = vi.fn()
const isNotificationChannelAllowedMock = vi.fn()
const markEventReceivedMock = vi.fn()
const markLastErrorMock = vi.fn()
const markSocketConnectedMock = vi.fn()
const pruneEventReceiptsMock = vi.fn()
const readLatestAssistantTextMock = vi.fn()
const recordEventReceiptMock = vi.fn()
let realReadLatestAssistantText: ReadLatestAssistantTextFn | null = null
const upsertThreadBindingMock = vi.fn()
const waitForSessionToCompleteMock = vi.fn()
const recordedEventIds = new Set<string>()

vi.mock('@slack/bolt', () => ({
  App: function App() {
    const instance = {
      action: vi.fn(),
      command: vi.fn(),
      error: vi.fn(),
      event: vi.fn(),
      start: vi.fn().mockImplementation(async () => {
        await nextAppStartImplementation?.()
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    appInstances.push(instance)
    appConstructorMock()
    return instance
  },
  LogLevel: { WARN: 'warn' },
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: (...args: unknown[]) => createInstanceClientMock(...args),
}))

vi.mock('@/lib/opencode/session-execution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opencode/session-execution')>()
  realReadLatestAssistantText = actual.readLatestAssistantText

  return {
    ...actual,
    captureSessionMessageCursor: (...args: unknown[]) => captureSessionMessageCursorMock(...args),
    ensureWorkspaceRunningForExecution: (...args: unknown[]) => ensureWorkspaceRunningForExecutionMock(...args),
    readLatestAssistantText: (...args: Parameters<ReadLatestAssistantTextFn>) => readLatestAssistantTextMock(...args),
    waitForSessionToComplete: (...args: unknown[]) => waitForSessionToCompleteMock(...args),
  }
})

vi.mock('../agents', () => ({
  loadSlackAgentOptions: (...args: unknown[]) => loadSlackAgentOptionsMock(...args),
}))

vi.mock('../context', () => ({
  buildSlackContext: (...args: unknown[]) => buildSlackContextMock(...args),
}))

vi.mock('../prompt', () => ({
  buildSlackPrompt: (...args: unknown[]) => buildSlackPromptMock(...args),
}))

vi.mock('../service-user', () => ({
  ensureSlackServiceUser: (...args: unknown[]) => ensureSlackServiceUserMock(...args),
}))

vi.mock('@/lib/services', () => ({
    auditService: {
      createEvent: (...args: unknown[]) => createAuditEventMock(...args),
    },
    slackService: {
      createDmSessionBinding: (...args: unknown[]) => createDmSessionBindingMock(...args),
      createPendingDmDecision: (...args: unknown[]) => createPendingDmDecisionMock(...args),
      deleteSessionBindingsByOpenCodeSessionId: (...args: unknown[]) => deleteSessionBindingsByOpenCodeSessionIdMock(...args),
      expirePendingDmDecision: (...args: unknown[]) => expirePendingDmDecisionMock(...args),
      findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
      findDmSessionBindingById: (...args: unknown[]) => findDmSessionBindingByIdMock(...args),
      findLatestDmSession: (...args: unknown[]) => findLatestDmSessionMock(...args),
      findPendingDmDecision: (...args: unknown[]) => findPendingDmDecisionMock(...args),
      hasEventReceipt: (...args: unknown[]) => hasEventReceiptMock(...args),
      findThreadBinding: (...args: unknown[]) => findThreadBindingMock(...args),
      isNotificationChannelAllowed: (...args: unknown[]) => isNotificationChannelAllowedMock(...args),
      markEventReceived: (...args: unknown[]) => markEventReceivedMock(...args),
      markLastError: (...args: unknown[]) => markLastErrorMock(...args),
      markPendingDmDecisionContinued: (...args: unknown[]) => markPendingDmDecisionContinuedMock(...args),
      markPendingDmDecisionStartedNew: (...args: unknown[]) => markPendingDmDecisionStartedNewMock(...args),
      markSocketConnected: (...args: unknown[]) => markSocketConnectedMock(...args),
      pruneEventReceipts: (...args: unknown[]) => pruneEventReceiptsMock(...args),
      recordEventReceipt: (...args: unknown[]) => recordEventReceiptMock(...args),
      resolveArcheUserFromSlackUser: (...args: unknown[]) => resolveArcheUserFromSlackUserMock(...args),
      touchDmSessionBinding: (...args: unknown[]) => touchDmSessionBindingMock(...args),
      upsertThreadBinding: (...args: unknown[]) => upsertThreadBindingMock(...args),
    },
    userService: {
      findByIdSelect: (...args: unknown[]) => findByIdSelectMock(...args),
    },
}))

describe('slack socket manager', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    appInstances.length = 0
    nextAppStartImplementation = null
    recordedEventIds.clear()
    const { stopSlackSocketManager } = await import('../socket-mode')
    stopSlackSocketManager()
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: 'xapp-1',
      botTokenSecret: 'xoxb-1',
      createdAt: new Date(),
      defaultAgentId: 'assistant',
      enabled: true,
      lastError: null,
      lastEventAt: null,
      lastSocketConnectedAt: null,
      singletonKey: 'default',
      slackAppId: 'A123',
      slackBotUserId: 'U999',
      slackTeamId: 'T123',
      updatedAt: new Date(),
      version: 1,
    })
    hasEventReceiptMock.mockImplementation(async (eventId: string) => recordedEventIds.has(eventId))
    findLatestDmSessionMock.mockResolvedValue(null)
    findPendingDmDecisionMock.mockResolvedValue(null)
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-1' })
    createPendingDmDecisionMock.mockResolvedValue({ id: 'decision-1' })
    deleteSessionBindingsByOpenCodeSessionIdMock.mockResolvedValue({ dm: 0, thread: 0 })
    markPendingDmDecisionContinuedMock.mockResolvedValue(true)
    markPendingDmDecisionStartedNewMock.mockResolvedValue(true)
    expirePendingDmDecisionMock.mockResolvedValue(undefined)
    resolveArcheUserFromSlackUserMock.mockResolvedValue({ ok: true, user: { id: 'user-1', slug: 'alice' } })
    touchDmSessionBindingMock.mockResolvedValue(undefined)
    findDmSessionBindingByIdMock.mockResolvedValue(null)
    createAuditEventMock.mockResolvedValue(undefined)
    findByIdSelectMock.mockResolvedValue({ slug: 'alice' })
    recordEventReceiptMock.mockImplementation(async ({ eventId }: { eventId: string }) => {
      if (recordedEventIds.has(eventId)) {
        return false
      }

      recordedEventIds.add(eventId)
      return true
    })
    findThreadBindingMock.mockResolvedValue(null)
    isNotificationChannelAllowedMock.mockResolvedValue(true)
    ensureSlackServiceUserMock.mockResolvedValue({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    ensureWorkspaceRunningForExecutionMock.mockResolvedValue(undefined)
    captureSessionMessageCursorMock.mockResolvedValue({ messageCount: 0 })
    loadSlackAgentOptionsMock.mockResolvedValue({
      agents: [{ displayName: 'Assistant', id: 'assistant', isPrimary: true }],
      ok: true,
      primaryAgentId: 'assistant',
    })
    buildSlackContextMock.mockResolvedValue({ contextText: 'ctx', mentionTokens: ['<@U123>'] })
    buildSlackPromptMock.mockReturnValue('prompt')
    waitForSessionToCompleteMock.mockResolvedValue(null)
    readLatestAssistantTextMock.mockResolvedValue('Final reply')
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
        promptAsync: vi.fn().mockResolvedValue({}),
      },
    })
    upsertThreadBindingMock.mockResolvedValue(undefined)
    markEventReceivedMock.mockResolvedValue(undefined)
    markLastErrorMock.mockResolvedValue(undefined)
    markSocketConnectedMock.mockResolvedValue(undefined)
    pruneEventReceiptsMock.mockResolvedValue(undefined)
  })

  it('posts a DM setup error when Slack team cannot be resolved', async () => {
    findIntegrationMock.mockResolvedValue(null)
    const client = createSlackClient()
    const { handleSlackDmEvent } = await import('../dm-handler')

    await handleSlackDmEvent({
      body: { event_id: 'evt-dm-no-team' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello',
        ts: '100.1',
        user: 'U123',
      },
      eventId: 'evt-dm-no-team',
    })

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'I could not identify the Slack workspace to link your account.',
    })
    expect(resolveArcheUserFromSlackUserMock).not.toHaveBeenCalled()
  })

  it('posts a DM account resolution error before starting a session', async () => {
    resolveArcheUserFromSlackUserMock.mockResolvedValue({ ok: false, error: 'slack_email_not_found' })
    const client = createSlackClient()
    const { handleSlackDmEvent } = await import('../dm-handler')

    await handleSlackDmEvent({
      body: { event_id: 'evt-dm-unlinked', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello',
        ts: '100.1',
        user: 'U123',
      },
      eventId: 'evt-dm-unlinked',
    })

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'I cannot find an Arche account with your Slack email. Check that your email matches or contact an admin.',
    })
    expect(createInstanceClientMock).not.toHaveBeenCalled()
  })

  it('ignores incomplete Slack DM events', async () => {
    const client = createSlackClient()
    const { handleSlackDmEvent } = await import('../dm-handler')

    await handleSlackDmEvent({
      body: { event_id: 'evt-dm-empty', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: '   ',
        ts: '100.1',
        user: 'U123',
      },
      eventId: 'evt-dm-empty',
    })

    expect(resolveArcheUserFromSlackUserMock).not.toHaveBeenCalled()
    expect(client.chat.postMessage).not.toHaveBeenCalled()
  })

  it('reports DM execution setup errors before posting a placeholder', async () => {
    createInstanceClientMock.mockResolvedValue(null)
    const client = createSlackClient()
    const { handleSlackDmEvent } = await import('../dm-handler')

    await expect(handleSlackDmEvent({
      body: { event_id: 'evt-dm-instance-missing', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello',
        ts: '100.1',
        user: 'U123',
      },
      eventId: 'evt-dm-instance-missing',
    })).rejects.toThrow('instance_unavailable')

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'I hit an error while preparing the Slack reply. Please try again.',
    })
    expect(client.chat.update).not.toHaveBeenCalled()
    expect(markLastErrorMock).toHaveBeenCalledWith('instance_unavailable')
  })

  it('starts a new DM conversation when the latest session is older than eight hours', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'))

    try {
      const promptAsyncMock = vi.fn().mockResolvedValue({})
      createInstanceClientMock.mockResolvedValue({
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: 'dm-session-new' } }),
          promptAsync: promptAsyncMock,
        },
      })
      findLatestDmSessionMock.mockResolvedValue({
        channelId: 'D123',
        executionUserId: 'user-1',
        id: 'dm-binding-old',
        lastMessageAt: new Date('2026-04-25T03:00:00.000Z'),
        openCodeSessionId: 'dm-session-old',
        slackTeamId: 'T123',
        slackUserId: 'U123',
      })
      createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-new' })
      const client = createSlackClient()
      const { handleSlackDmEvent } = await import('../dm-handler')

      await handleSlackDmEvent({
        body: { event_id: 'evt-dm-old', team_id: 'T123' },
        client,
        event: {
          channel: 'D123',
          channel_type: 'im',
          text: 'hello again',
          ts: '100.1',
          user: 'U123',
        },
        eventId: 'evt-dm-old',
      })

      expect(createPendingDmDecisionMock).not.toHaveBeenCalled()
      expect(promptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: 'dm-session-new' }),
        { throwOnError: true },
      )
      expect(client.chat.update).toHaveBeenCalledWith({
        channel: 'D123',
        text: 'More than 8 hours have passed, so I started a new conversation.\n\nFinal reply',
        ts: 'reply-1',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports /new setup and account resolution failures', async () => {
    const client = createSlackClient()
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const { handleNewSlackDmCommand } = await import('../dm-handler')

    findIntegrationMock.mockResolvedValueOnce(null)
    await handleNewSlackDmCommand({
      body: {
        channel_id: 'D123',
        channel_name: 'directmessage',
        text: 'start',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })
    expect(respondMock).toHaveBeenCalledWith({ text: 'I could not identify the Slack workspace to link your account.' })

    resolveArcheUserFromSlackUserMock.mockResolvedValueOnce({ ok: false, error: 'slack_email_missing' })
    await handleNewSlackDmCommand({
      body: {
        channel_id: 'D123',
        channel_name: 'directmessage',
        team_id: 'T123',
        text: 'start',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })
    expect(respondMock).toHaveBeenCalledWith({
      text: 'I cannot read your Slack email. Ask an admin to verify the users:read.email scope.',
    })
  })

  it('reports /new execution setup errors without throwing', async () => {
    createInstanceClientMock.mockResolvedValue(null)
    const client = createSlackClient()
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const { handleNewSlackDmCommand } = await import('../dm-handler')

    await handleNewSlackDmCommand({
      body: {
        channel_id: 'D123',
        channel_name: 'directmessage',
        team_id: 'T123',
        text: '',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })

    expect(respondMock).toHaveBeenCalledWith({ text: 'I hit an error while preparing the Slack reply. Please try again.' })
    expect(markLastErrorMock).toHaveBeenCalledWith('instance_unavailable')
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })

  it('rejects invalid pending DM decisions', async () => {
    const client = createSlackClient()
    const { handleSlackDmDecisionAction } = await import('../dm-handler')

    await handleSlackDmDecisionAction({
      action: 'continue',
      body: {
        actions: [],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
      },
      client,
    })

    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision is no longer valid.',
      ts: 'decision-ts',
    })

    findPendingDmDecisionMock.mockResolvedValueOnce({ status: 'continued' })
    await handleSlackDmDecisionAction({
      action: 'continue',
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
      },
      client,
    })

    expect(client.chat.update).toHaveBeenLastCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision is no longer valid.',
      ts: 'decision-ts',
    })
  })

  it('rejects pending DM decision continuations without usable previous sessions', async () => {
    const client = createSlackClient()
    const { handleSlackDmDecisionAction } = await import('../dm-handler')

    findPendingDmDecisionMock.mockResolvedValueOnce({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'continue this',
      previousDmSessionBindingId: null,
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    await handleSlackDmDecisionAction({
      action: 'continue',
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })
    expect(expirePendingDmDecisionMock).toHaveBeenCalledWith('decision-1')

    findPendingDmDecisionMock.mockResolvedValueOnce({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-2',
      messageText: 'continue this',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-2',
      sourceTs: '100.2',
      status: 'pending',
    })
    findDmSessionBindingByIdMock.mockResolvedValueOnce({
      executionUserId: 'user-1',
      id: 'dm-binding-1',
      openCodeSessionId: 'dm-session-1',
    })
    markPendingDmDecisionContinuedMock.mockResolvedValueOnce(false)
    await handleSlackDmDecisionAction({
      action: 'continue',
      body: {
        actions: [{ value: 'decision-2' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(client.chat.update).toHaveBeenLastCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision is no longer valid.',
      ts: 'decision-ts',
    })
  })

  it('rejects start-new DM decisions when user resolution fails', async () => {
    const client = createSlackClient()
    const { handleSlackDmDecisionAction } = await import('../dm-handler')
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'start over',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    resolveArcheUserFromSlackUserMock.mockResolvedValueOnce({ ok: false, error: 'slack_email_not_found' })

    await handleSlackDmDecisionAction({
      action: 'start_new',
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(markPendingDmDecisionStartedNewMock).toHaveBeenCalledWith('decision-1')
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'I cannot find an Arche account with your Slack email. Check that your email matches or contact an admin.',
      ts: 'decision-ts',
    })
    expect(createInstanceClientMock).not.toHaveBeenCalled()
  })

  it('starts a new conversation for a start-new DM decision', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'dm-session-new' } })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: promptAsyncMock,
      },
    })
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-new' })
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'start over',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    const client = createSlackClient()
    const { handleSlackDmDecisionAction } = await import('../dm-handler')

    await handleSlackDmDecisionAction({
      action: 'start_new',
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(markPendingDmDecisionStartedNewMock).toHaveBeenCalledWith('decision-1')
    expect(createDmSessionBindingMock).toHaveBeenCalledWith({
      channelId: 'D123',
      executionUserId: 'user-1',
      openCodeSessionId: 'dm-session-new',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'Starting a new conversation...',
      ts: 'decision-ts',
    })
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'dm-session-new' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'Final reply',
      ts: 'reply-1',
    })
  })

  it('starts a socket-mode app for an enabled integration', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()

    expect(appConstructorMock).toHaveBeenCalledTimes(1)
    expect(appInstances[0].start).toHaveBeenCalledTimes(1)

    stopSlackSocketManager()
  })

  it('coalesces concurrent sync requests', async () => {
    const integrationDeferred = createDeferred<Awaited<ReturnType<typeof findIntegrationMock>>>()
    findIntegrationMock.mockReturnValueOnce(integrationDeferred.promise)
    const { syncSlackSocketManager } = await import('../socket-mode')

    const firstSync = syncSlackSocketManager()
    const secondSync = syncSlackSocketManager()

    await vi.waitFor(() => expect(findIntegrationMock).toHaveBeenCalledTimes(1))
    integrationDeferred.resolve(null)
    await Promise.all([firstSync, secondSync])
  })

  it('tears down the current app when integration is disabled', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()
    findIntegrationMock.mockResolvedValueOnce({
      appTokenSecret: 'xapp-1',
      botTokenSecret: 'xoxb-1',
      enabled: false,
      version: 2,
    })
    await syncSlackSocketManager(true)

    expect(appInstances[0].stop).toHaveBeenCalledTimes(1)
    stopSlackSocketManager()
  })

  it('logs stop errors when shutting down the current socket app', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()
    appInstances[0].stop.mockRejectedValueOnce(new Error('stop failed'))
    stopSlackSocketManager()

    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith('[slack] Failed to stop socket app', expect.any(Error)))
    consoleErrorSpy.mockRestore()
  })

  it('does not rebuild the socket app when config version is unchanged', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()
    await syncSlackSocketManager()

    expect(appConstructorMock).toHaveBeenCalledTimes(1)
    stopSlackSocketManager()
  })

  it('rebuilds the socket app after a runtime error even when the config version is unchanged', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()

    const errorHandler = appInstances[0].error.mock.calls[0]?.[0]
    expect(typeof errorHandler).toBe('function')

    await errorHandler(new Error('socket_lost'))
    await syncSlackSocketManager()

    expect(appConstructorMock).toHaveBeenCalledTimes(2)
    expect(appInstances[0].stop).toHaveBeenCalledTimes(1)
    expect(appInstances[1].start).toHaveBeenCalledTimes(1)

    stopSlackSocketManager()
  })

  it('deduplicates repeated Slack events and binds a new thread to a session', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(recordEventReceiptMock).toHaveBeenCalledWith({
      eventId: 'evt-1',
      receivedAt: expect.any(Date),
      type: 'app_mention',
    })
    expect(upsertThreadBindingMock).toHaveBeenCalledWith({
      channelId: 'C123',
      executionUserId: 'service-1',
      openCodeSessionId: 'session-1',
      threadTs: '100.1',
    })
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Final reply',
      ts: 'reply-1',
    })

    await mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello again',
        ts: '100.2',
        user: 'U123',
      },
    })

    expect(upsertThreadBindingMock).toHaveBeenCalledTimes(1)
    expect(recordEventReceiptMock).toHaveBeenCalledTimes(1)

    stopSlackSocketManager()
  })

  it('starts a new Slack thread conversation when the binding points at a deleted session', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'thread-session-new' } })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: promptAsyncMock,
      },
    })
    findThreadBindingMock.mockResolvedValue({
      channelId: 'C123',
      createdAt: new Date(),
      executionUserId: 'service-1',
      id: 'thread-binding-stale',
      openCodeSessionId: 'thread-session-deleted',
      threadTs: '100.1',
      updatedAt: new Date(),
    })
    captureSessionMessageCursorMock
      .mockRejectedValueOnce(new Error('session not found'))
      .mockResolvedValue({ messageCount: 0 })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-thread-stale', team_id: 'T123' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello after deletion',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(deleteSessionBindingsByOpenCodeSessionIdMock).toHaveBeenCalledWith('thread-session-deleted')
    expect(upsertThreadBindingMock).toHaveBeenCalledWith({
      channelId: 'C123',
      executionUserId: 'service-1',
      openCodeSessionId: 'thread-session-new',
      threadTs: '100.1',
    })
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'thread-session-new' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'The previous Slack thread conversation was no longer available, so I started a new conversation.\n\nFinal reply',
      ts: 'reply-1',
    })

    stopSlackSocketManager()
  })

  it('recovers a Slack thread when the bound session is deleted during prompt execution', async () => {
    const promptAsyncMock = vi.fn()
      .mockRejectedValueOnce(new Error('session not found'))
      .mockResolvedValue({})
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'thread-session-recovered' } })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: promptAsyncMock,
      },
    })
    findThreadBindingMock.mockResolvedValue({
      channelId: 'C123',
      createdAt: new Date(),
      executionUserId: 'service-1',
      id: 'thread-binding-existing',
      openCodeSessionId: 'thread-session-existing',
      threadTs: '100.1',
      updatedAt: new Date(),
    })
    const client = createSlackClient()
    const { handleSlackThreadEvent } = await import('../thread-handler')

    await handleSlackThreadEvent({
      channel: 'C123',
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello during deletion',
        thread_ts: '100.1',
        ts: '100.2',
        user: 'U123',
      },
      eventTs: '100.2',
      isMention: true,
      savedBotUserId: 'U999',
      threadTs: '100.1',
    })

    expect(deleteSessionBindingsByOpenCodeSessionIdMock).toHaveBeenCalledWith('thread-session-existing')
    expect(upsertThreadBindingMock).toHaveBeenCalledWith({
      channelId: 'C123',
      executionUserId: 'service-1',
      openCodeSessionId: 'thread-session-recovered',
      threadTs: '100.1',
    })
    expect(promptAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionID: 'thread-session-existing' }),
      { throwOnError: true },
    )
    expect(promptAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionID: 'thread-session-recovered' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'The previous Slack thread conversation was no longer available, so I started a new conversation.\n\nFinal reply',
      ts: 'reply-1',
    })
  })

  it('silently ignores top-level channel messages without a mention', async () => {
    isNotificationChannelAllowedMock.mockResolvedValue(false)
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-channel-unmentioned', team_id: 'T123' },
      client,
      event: {
        channel: 'C999',
        text: 'hello channel',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.postMessage).not.toHaveBeenCalled()
    expect(client.chat.update).not.toHaveBeenCalled()
    expect(findThreadBindingMock).not.toHaveBeenCalled()
    expect(isNotificationChannelAllowedMock).not.toHaveBeenCalled()
    expect(ensureSlackServiceUserMock).not.toHaveBeenCalled()
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    expect(recordEventReceiptMock).not.toHaveBeenCalled()

    stopSlackSocketManager()
  })

  it('silently ignores unmentioned thread replies without a binding', async () => {
    isNotificationChannelAllowedMock.mockResolvedValue(false)
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-thread-unbound', team_id: 'T123' },
      client,
      event: {
        channel: 'C123',
        text: 'hello thread',
        thread_ts: '100.1',
        ts: '100.2',
        user: 'U123',
      },
    })

    expect(findThreadBindingMock).toHaveBeenCalledWith('C123', '100.1')
    expect(client.chat.postMessage).not.toHaveBeenCalled()
    expect(client.chat.update).not.toHaveBeenCalled()
    expect(isNotificationChannelAllowedMock).not.toHaveBeenCalled()
    expect(ensureSlackServiceUserMock).not.toHaveBeenCalled()
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    expect(recordEventReceiptMock).not.toHaveBeenCalled()

    stopSlackSocketManager()
  })

  it('continues an unmentioned thread reply when a binding exists', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'new-session' } }),
        promptAsync: promptAsyncMock,
      },
    })
    const binding = {
      channelId: 'C123',
      createdAt: new Date(),
      executionUserId: 'service-1',
      id: 'thread-binding-1',
      openCodeSessionId: 'thread-session-1',
      threadTs: '100.1',
      updatedAt: new Date(),
    }
    findThreadBindingMock.mockResolvedValue(binding)
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-thread-bound', team_id: 'T123' },
      client,
      event: {
        channel: 'C123',
        text: 'continue thread',
        thread_ts: '100.1',
        ts: '100.2',
        user: 'U123',
      },
    })

    expect(findThreadBindingMock).toHaveBeenCalledTimes(2)
    expect(isNotificationChannelAllowedMock).toHaveBeenCalledWith('T123', 'C123')
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'thread-session-1' }),
      { throwOnError: true },
    )
    expect(upsertThreadBindingMock).not.toHaveBeenCalled()
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Final reply',
      ts: 'reply-1',
    })
    expect(recordEventReceiptMock).toHaveBeenCalledWith({
      eventId: 'evt-thread-bound',
      receivedAt: expect.any(Date),
      type: 'message',
    })

    stopSlackSocketManager()
  })

  it('creates a user-scoped session for a new Slack DM', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'dm-session-1' } }),
        promptAsync: promptAsyncMock,
      },
    })
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-1' })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-dm-1', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello from dm',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(resolveArcheUserFromSlackUserMock).toHaveBeenCalledWith('T123', 'U123', 'alice@test.com', 'Alice')
    expect(ensureWorkspaceRunningForExecutionMock).toHaveBeenCalledWith('alice', 'user-1')
    expect(createDmSessionBindingMock).toHaveBeenCalledWith({
      channelId: 'D123',
      executionUserId: 'user-1',
      openCodeSessionId: 'dm-session-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'dm-session-1',
        parts: [expect.objectContaining({ text: expect.stringContaining('Slack direct message') })],
      }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'Final reply',
      ts: 'reply-1',
    })
    expect(recordEventReceiptMock).toHaveBeenCalledWith({
      eventId: 'evt-dm-1',
      receivedAt: expect.any(Date),
      type: 'message.im',
    })

    stopSlackSocketManager()
  })

  it('starts a new Slack DM conversation when the latest binding points at a deleted session', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'dm-session-new' } })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: promptAsyncMock,
      },
    })
    findLatestDmSessionMock.mockResolvedValue({
      channelId: 'D123',
      executionUserId: 'user-1',
      id: 'dm-binding-stale',
      lastMessageAt: new Date(),
      openCodeSessionId: 'dm-session-deleted',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    captureSessionMessageCursorMock
      .mockRejectedValueOnce(new Error('session not found'))
      .mockResolvedValue({ messageCount: 0 })
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-new' })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-dm-stale', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello after deletion',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(deleteSessionBindingsByOpenCodeSessionIdMock).toHaveBeenCalledWith('dm-session-deleted')
    expect(sessionCreateMock).toHaveBeenCalledTimes(1)
    expect(createDmSessionBindingMock).toHaveBeenCalledWith({
      channelId: 'D123',
      executionUserId: 'user-1',
      openCodeSessionId: 'dm-session-new',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'dm-session-new' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'The previous Slack conversation was no longer available, so I started a new conversation.\n\nFinal reply',
      ts: 'reply-1',
    })

    stopSlackSocketManager()
  })

  it('recovers a Slack DM when the bound session is deleted during prompt execution', async () => {
    const promptAsyncMock = vi.fn()
      .mockRejectedValueOnce(new Error('session not found'))
      .mockResolvedValue({})
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'dm-session-recovered' } })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: promptAsyncMock,
      },
    })
    findLatestDmSessionMock.mockResolvedValue({
      channelId: 'D123',
      executionUserId: 'user-1',
      id: 'dm-binding-existing',
      lastMessageAt: new Date(),
      openCodeSessionId: 'dm-session-existing',
      slackTeamId: 'T123',
      slackUserId: 'U123',
    })
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-recovered' })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-dm-race', team_id: 'T123' },
      client,
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: 'hello during deletion',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(deleteSessionBindingsByOpenCodeSessionIdMock).toHaveBeenCalledWith('dm-session-existing')
    expect(promptAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionID: 'dm-session-existing' }),
      { throwOnError: true },
    )
    expect(promptAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionID: 'dm-session-recovered' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'D123',
      text: 'The previous Slack conversation was no longer available, so I started a new conversation.\n\nFinal reply',
      ts: 'reply-1',
    })

    stopSlackSocketManager()
  })

  it('does not execute channel prompts outside enabled Slack channels', async () => {
    isNotificationChannelAllowedMock.mockResolvedValue(false)
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'auth-reply' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-channel-not-allowed', team_id: 'T123' },
      client,
      event: {
        channel: 'C999',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C999',
      text: 'This Slack channel is not enabled for Arche replies. Ask an admin to allow it in Slack settings.',
      thread_ts: '100.1',
    })
    expect(ensureSlackServiceUserMock).not.toHaveBeenCalled()
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    expect(recordEventReceiptMock).toHaveBeenCalledWith({
      eventId: 'evt-channel-not-allowed',
      receivedAt: expect.any(Date),
      type: 'app_mention',
    })

    stopSlackSocketManager()
  })

  it('does not execute channel prompts for unlinked Slack users', async () => {
    resolveArcheUserFromSlackUserMock.mockResolvedValueOnce({ ok: false, error: 'slack_email_not_found' })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'auth-reply' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'unknown@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-channel-unlinked', team_id: 'T123' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(resolveArcheUserFromSlackUserMock).toHaveBeenCalledWith('T123', 'U123', 'unknown@test.com', 'Alice')
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'I cannot find an Arche account with your Slack email. Check that your email matches or contact an admin.',
      thread_ts: '100.1',
    })
    expect(ensureSlackServiceUserMock).not.toHaveBeenCalled()
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    expect(recordEventReceiptMock).toHaveBeenCalledWith({
      eventId: 'evt-channel-unlinked',
      receivedAt: expect.any(Date),
      type: 'app_mention',
    })

    stopSlackSocketManager()
  })

  it('prompts for a DM decision when the latest session is between two and eight hours old', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'))

    try {
      findLatestDmSessionMock.mockResolvedValue({
        id: 'dm-binding-old',
        lastMessageAt: new Date('2026-04-25T09:00:00.000Z'),
        openCodeSessionId: 'dm-session-old',
      })
      createPendingDmDecisionMock.mockResolvedValue({ id: 'decision-1' })
      const client = {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: 'decision-ts' }),
          update: vi.fn().mockResolvedValue({}),
        },
        conversations: {
          history: vi.fn().mockResolvedValue({ messages: [] }),
          replies: vi.fn().mockResolvedValue({ messages: [] }),
        },
        users: {
          info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
        },
      }

      const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
      await syncSlackSocketManager()

      const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
      await messageHandler({
        body: { event_id: 'evt-dm-decision', team_id: 'T123' },
        client,
        event: {
          channel: 'D123',
          channel_type: 'im',
          text: 'should wait',
          ts: '100.1',
          user: 'U123',
        },
      })

      expect(createPendingDmDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageText: 'should wait',
          previousDmSessionBindingId: 'dm-binding-old',
        }),
      )
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.any(Array),
          channel: 'D123',
        }),
      )
      expect(createInstanceClientMock).not.toHaveBeenCalled()
      stopSlackSocketManager()
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles /new in a DM and sends an optional first prompt', async () => {
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const ackMock = vi.fn().mockResolvedValue(undefined)
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'new-session-1' } }),
        promptAsync: promptAsyncMock,
      },
    })
    createDmSessionBindingMock.mockResolvedValue({ id: 'dm-binding-new' })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const commandHandler = appInstances[0].command.mock.calls.find(([name]) => name === '/new')?.[1]
    expect(typeof commandHandler).toBe('function')

    await commandHandler({
      ack: ackMock,
      body: {
        channel_id: 'D123',
        channel_name: 'directmessage',
        team_id: 'T123',
        text: 'start here',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })

    expect(ackMock).toHaveBeenCalled()
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'slack.new_command_used' }),
    )
    expect(promptAsyncMock).toHaveBeenCalled()
    expect(respondMock).toHaveBeenCalledWith({ text: 'New conversation started. Thinking...' })
    stopSlackSocketManager()
  })

  it('responds to malformed /new commands without creating sessions', async () => {
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const ackMock = vi.fn().mockResolvedValue(undefined)
    const client = createSlackClient()

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const commandHandler = appInstances[0].command.mock.calls.find(([name]) => name === '/new')?.[1]
    expect(typeof commandHandler).toBe('function')

    await commandHandler({
      ack: ackMock,
      body: { team_id: 'T123', text: 'start here' },
      client,
      respond: respondMock,
    })

    expect(ackMock).toHaveBeenCalled()
    expect(respondMock).toHaveBeenCalledWith({ text: 'I could not interpret the /new command.' })
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('rejects /new outside DMs before resolving a user', async () => {
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const client = createSlackClient()

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const commandHandler = appInstances[0].command.mock.calls.find(([name]) => name === '/new')?.[1]
    await commandHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        channel_id: 'C123',
        channel_name: 'general',
        team_id: 'T123',
        text: 'start here',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })

    expect(respondMock).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: '/new is intended for Arche DMs. For channels, mention Arche in a thread.',
    })
    expect(resolveArcheUserFromSlackUserMock).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('starts a /new DM conversation without an optional first prompt', async () => {
    const respondMock = vi.fn().mockResolvedValue(undefined)
    const client = createSlackClient()
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'new-session-1' } }),
        promptAsync: vi.fn().mockResolvedValue({}),
      },
    })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const commandHandler = appInstances[0].command.mock.calls.find(([name]) => name === '/new')?.[1]
    await commandHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        channel_id: 'D123',
        channel_name: 'directmessage',
        team_id: 'T123',
        text: '   ',
        user_id: 'U123',
      },
      client,
      respond: respondMock,
    })

    expect(respondMock).toHaveBeenCalledWith({ text: 'New conversation started. Send your next message here.' })
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'slack.new_command_used' }),
    )
    expect(client.chat.update).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('expires stale pending DM decisions', async () => {
    const client = createSlackClient()
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() - 60_000),
      id: 'decision-1',
      messageText: 'continue this',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const actionHandler = appInstances[0].action.mock.calls.find(([name]) => name === 'continue_conversation')?.[1]
    await actionHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(expirePendingDmDecisionMock).toHaveBeenCalledWith('decision-1')
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision expired. Send your message again to continue.',
      ts: 'decision-ts',
    })
    expect(markPendingDmDecisionContinuedMock).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('rejects pending DM decisions that cannot find their previous binding', async () => {
    const client = createSlackClient()
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'continue this',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    findDmSessionBindingByIdMock.mockResolvedValue(null)

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const actionHandler = appInstances[0].action.mock.calls.find(([name]) => name === 'continue_conversation')?.[1]
    await actionHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(expirePendingDmDecisionMock).toHaveBeenCalledWith('decision-1')
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'I could not find the previous conversation. Send your message again to start over.',
      ts: 'decision-ts',
    })
    expect(markPendingDmDecisionContinuedMock).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('rejects start-new DM decisions that lose their claim', async () => {
    const client = createSlackClient()
    markPendingDmDecisionStartedNewMock.mockResolvedValue(false)
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'start over',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const actionHandler = appInstances[0].action.mock.calls.find(([name]) => name === 'start_new_conversation')?.[1]
    await actionHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision is no longer valid.',
      ts: 'decision-ts',
    })
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('continues a pending DM decision only once', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({})
    createInstanceClientMock.mockResolvedValue({
      session: {
        promptAsync: promptAsyncMock,
      },
    })
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'continue this',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    findDmSessionBindingByIdMock.mockResolvedValue({
      executionUserId: 'user-1',
      id: 'dm-binding-1',
      openCodeSessionId: 'dm-session-1',
    })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const actionHandler = appInstances[0].action.mock.calls.find(([name]) => name === 'continue_conversation')?.[1]
    expect(typeof actionHandler).toBe('function')

    await actionHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U123' },
      },
      client,
    })

    expect(markPendingDmDecisionContinuedMock).toHaveBeenCalledWith('decision-1')
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'dm-session-1' }),
      { throwOnError: true },
    )
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'Continuing the previous conversation...',
      ts: 'decision-ts',
    })
    stopSlackSocketManager()
  })

  it('rejects a DM decision action from a different Slack user', async () => {
    findPendingDmDecisionMock.mockResolvedValue({
      channelId: 'D123',
      expiresAt: new Date(Date.now() + 60_000),
      id: 'decision-1',
      messageText: 'continue this',
      previousDmSessionBindingId: 'dm-binding-1',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      sourceEventId: 'evt-1',
      sourceTs: '100.1',
      status: 'pending',
    })
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice', email: 'alice@test.com' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const actionHandler = appInstances[0].action.mock.calls.find(([name]) => name === 'continue_conversation')?.[1]
    expect(typeof actionHandler).toBe('function')

    await actionHandler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        actions: [{ value: 'decision-1' }],
        channel: { id: 'D123' },
        message: { ts: 'decision-ts' },
        team: { id: 'T123' },
        user: { id: 'U999' },
      },
      client,
    })

    expect(markPendingDmDecisionContinuedMock).not.toHaveBeenCalled()
    expect(createInstanceClientMock).not.toHaveBeenCalled()
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'D123',
      text: 'This decision is no longer valid.',
      ts: 'decision-ts',
    })

    stopSlackSocketManager()
  })

  it('publishes only the visible assistant text when the session message includes reasoning parts', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }
    const sessionMessagesMock = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
          },
          parts: [
            { id: 'part-1', text: 'Internal reasoning', type: 'reasoning' },
            { id: 'part-2', text: 'Final reply', type: 'text' },
          ],
        },
      ],
    })

    readLatestAssistantTextMock.mockImplementation((...args: Parameters<ReadLatestAssistantTextFn>) => {
      if (!realReadLatestAssistantText) {
        throw new Error('readLatestAssistantText_unavailable')
      }

      return realReadLatestAssistantText(...args)
    })
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
        messages: sessionMessagesMock,
        promptAsync: vi.fn().mockResolvedValue({}),
      },
    })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-visible-reply' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Final reply',
      ts: 'reply-1',
    })

    stopSlackSocketManager()
  })

  it('posts an actionable reply when provider credentials are missing', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    waitForSessionToCompleteMock.mockResolvedValue('provider_auth_missing')

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-provider-auth' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'I cannot answer in Slack yet because this workspace has no provider credentials configured. Add a provider API key in Settings > Providers and try again.',
      ts: 'reply-1',
    })
    expect(readLatestAssistantTextMock).not.toHaveBeenCalled()

    stopSlackSocketManager()
  })

  it('does not persist an event receipt when processing fails, so the same event can retry', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    ensureSlackServiceUserMock
      .mockResolvedValueOnce({ ok: false, error: 'service_user_conflict' })
      .mockResolvedValue({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(recordEventReceiptMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[slack] Failed to handle event',
      expect.objectContaining({ eventId: 'evt-1', type: 'app_mention' }),
    )

    await mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello again',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(upsertThreadBindingMock).toHaveBeenCalledTimes(1)
    expect(recordEventReceiptMock).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
    stopSlackSocketManager()
  })

  it('does not store receipts for ignored Slack bot messages', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const messageHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'message')?.[1]
    expect(typeof messageHandler).toBe('function')

    await messageHandler({
      body: { event_id: 'evt-bot-1' },
      client,
      event: {
        bot_id: 'B123',
        channel: 'C123',
        text: 'ignored',
        ts: '100.1',
      },
    })

    expect(recordEventReceiptMock).not.toHaveBeenCalled()
    expect(pruneEventReceiptsMock).not.toHaveBeenCalled()

    stopSlackSocketManager()
  })

  it('ignores invalid event envelopes and self-authored messages', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: null,
      client,
      event: { channel: 'C123', text: '<@U999> hello', ts: '100.1', user: 'U123' },
    })
    await mentionHandler({
      body: { event_id: 'evt-self-1' },
      client,
      event: { channel: 'C123', text: '<@U999> hello', ts: '100.1', user: 'U999' },
    })
    await mentionHandler({
      body: { event_id: 'evt-subtype-1' },
      client,
      event: { channel: 'C123', subtype: 'message_changed', text: '<@U999> hello', ts: '100.1', user: 'U123' },
    })

    expect(recordEventReceiptMock).not.toHaveBeenCalled()
    expect(client.chat.postMessage).not.toHaveBeenCalled()
    stopSlackSocketManager()
  })

  it('posts a final reply when the placeholder message fails', async () => {
    const client = {
      chat: {
        postMessage: vi.fn()
          .mockRejectedValueOnce(new Error('placeholder failed'))
          .mockResolvedValueOnce({ ts: 'reply-2' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: 'evt-placeholder-failed' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.update).not.toHaveBeenCalled()
    expect(client.chat.postMessage).toHaveBeenLastCalledWith({
      channel: 'C123',
      text: 'Final reply',
      thread_ts: '100.1',
    })
    stopSlackSocketManager()
  })

  it.each([
    ['autopilot_run_timeout', 'I took too long to reply in Slack. Please try again.'],
    ['autopilot_no_assistant_message', 'I could not produce a Slack reply for that message.'],
    ['unexpected_failure', 'I hit an error while preparing the Slack reply. Please try again.'],
  ])('maps %s failures to Slack replies', async (failure, expectedText) => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    waitForSessionToCompleteMock.mockResolvedValue(failure)
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await mentionHandler({
      body: { event_id: `evt-${failure}` },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })

    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      text: expectedText,
      ts: 'reply-1',
    })
    stopSlackSocketManager()
  })

  it('serializes concurrent events for a new Slack thread so only one session is created', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }
    const firstSession = createDeferred<{ data: { id: string } }>()
    const secondSession = createDeferred<{ data: { id: string } }>()
    const sessionCreateMock = vi.fn()
      .mockImplementationOnce(() => firstSession.promise)
      .mockImplementationOnce(() => secondSession.promise)
    let binding: {
      channelId: string
      createdAt: Date
      executionUserId: string
      id: string
      openCodeSessionId: string
      threadTs: string
      updatedAt: Date
    } | null = null

    findThreadBindingMock.mockImplementation(async () => binding)
    upsertThreadBindingMock.mockImplementation(async (args: {
      channelId: string
      executionUserId: string
      openCodeSessionId: string
      threadTs: string
    }) => {
      binding = {
        channelId: args.channelId,
        createdAt: new Date(),
        executionUserId: args.executionUserId,
        id: 'binding-1',
        openCodeSessionId: args.openCodeSessionId,
        threadTs: args.threadTs,
        updatedAt: new Date(),
      }
    })

    createInstanceClientMock.mockResolvedValue({
      session: {
        create: sessionCreateMock,
        promptAsync: vi.fn().mockResolvedValue({}),
      },
    })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    const firstReply = mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> first',
        ts: '100.1',
        user: 'U123',
      },
    })
    const secondReply = mentionHandler({
      body: { event_id: 'evt-2' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> second',
        thread_ts: '100.1',
        ts: '100.2',
        user: 'U456',
      },
    })

    await vi.waitFor(() => {
      expect(sessionCreateMock).toHaveBeenCalled()
    })

    firstSession.resolve({ data: { id: 'session-1' } })
    secondSession.resolve({ data: { id: 'session-2' } })

    await Promise.all([firstReply, secondReply])

    expect(sessionCreateMock).toHaveBeenCalledTimes(1)
    expect(upsertThreadBindingMock).toHaveBeenCalledTimes(1)

    stopSlackSocketManager()
  })

  it('prunes old Slack event receipts after recording a new event', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'))
      const client = {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
          update: vi.fn().mockResolvedValue({}),
        },
        conversations: {
          history: vi.fn().mockResolvedValue({ messages: [] }),
          replies: vi.fn().mockResolvedValue({ messages: [] }),
        },
        users: {
          info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
        },
      }

      const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
      await syncSlackSocketManager()

      const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
      expect(typeof mentionHandler).toBe('function')

      await mentionHandler({
        body: { event_id: 'evt-prune-1' },
        client,
        event: {
          channel: 'C123',
          text: '<@U999> hello',
          ts: '100.1',
          user: 'U123',
        },
      })

      expect(pruneEventReceiptsMock).toHaveBeenCalledWith(new Date('2026-04-13T00:00:00.000Z'))

      stopSlackSocketManager()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retain a socket app that finishes starting after shutdown begins', async () => {
    const startDeferred = createDeferred<void>()
    nextAppStartImplementation = () => startDeferred.promise

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    const syncPromise = syncSlackSocketManager()

    await vi.waitFor(() => {
      expect(appConstructorMock).toHaveBeenCalledTimes(1)
      expect(appInstances[0].start).toHaveBeenCalledTimes(1)
    })

    stopSlackSocketManager()
    startDeferred.resolve(undefined)
    await syncPromise

    expect(appInstances[0].stop).toHaveBeenCalledTimes(1)

    await syncSlackSocketManager()

    expect(appConstructorMock).toHaveBeenCalledTimes(2)

    stopSlackSocketManager()
  })

  it('posts a fallback reply and records the error when setup fails before the prompt starts', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'reply-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        history: vi.fn().mockResolvedValue({ messages: [] }),
        replies: vi.fn().mockResolvedValue({ messages: [] }),
      },
      users: {
        info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'Alice' } } }),
      },
    }

    ensureSlackServiceUserMock.mockResolvedValueOnce({ ok: false, error: 'service_user_conflict' })

    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')
    await syncSlackSocketManager()

    const mentionHandler = appInstances[0].event.mock.calls.find(([name]) => name === 'app_mention')?.[1]
    expect(typeof mentionHandler).toBe('function')

    await expect(mentionHandler({
      body: { event_id: 'evt-1' },
      client,
      event: {
        channel: 'C123',
        text: '<@U999> hello',
        ts: '100.1',
        user: 'U123',
      },
    })).resolves.toBeUndefined()

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'I hit an error while preparing the Slack reply. Please try again.',
      thread_ts: '100.1',
    })
    expect(markLastErrorMock).toHaveBeenCalledWith('service_user_conflict')

    stopSlackSocketManager()
  })

  it('records a sync error and tears down the current app when app start fails', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()

    nextAppStartImplementation = async () => {
      throw new Error('start_failed')
    }

    await expect(syncSlackSocketManager(true)).rejects.toThrow('start_failed')

    expect(appInstances[0].stop).toHaveBeenCalledTimes(1)
    expect(markLastErrorMock).toHaveBeenCalledWith('start_failed')

    stopSlackSocketManager()
  })
})
