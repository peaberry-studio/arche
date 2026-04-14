import { beforeEach, describe, expect, it, vi } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
}

const appConstructorMock = vi.fn()
const appInstances: Array<{
  error: ReturnType<typeof vi.fn>
  event: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}> = []

const loadSlackAgentOptionsMock = vi.fn()
const buildSlackContextMock = vi.fn()
const buildSlackPromptMock = vi.fn()
const createInstanceClientMock = vi.fn()
const decryptSlackTokenMock = vi.fn()
const ensureSlackServiceUserMock = vi.fn()
const ensureWorkspaceRunningForExecutionMock = vi.fn()
const findIntegrationMock = vi.fn()
const findThreadBindingMock = vi.fn()
const markEventReceivedMock = vi.fn()
const markLastErrorMock = vi.fn()
const markSocketConnectedMock = vi.fn()
const readLatestAssistantTextMock = vi.fn()
const recordEventReceiptMock = vi.fn()
const upsertThreadBindingMock = vi.fn()
const waitForSessionToCompleteMock = vi.fn()

vi.mock('@slack/bolt', () => ({
  App: function App() {
    const instance = {
      error: vi.fn(),
      event: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/lib/opencode/session-execution', () => ({
  ensureWorkspaceRunningForExecution: (...args: unknown[]) => ensureWorkspaceRunningForExecutionMock(...args),
  readLatestAssistantText: (...args: unknown[]) => readLatestAssistantTextMock(...args),
  waitForSessionToComplete: (...args: unknown[]) => waitForSessionToCompleteMock(...args),
}))

vi.mock('../agents', () => ({
  loadSlackAgentOptions: (...args: unknown[]) => loadSlackAgentOptionsMock(...args),
}))

vi.mock('../context', () => ({
  buildSlackContext: (...args: unknown[]) => buildSlackContextMock(...args),
}))

vi.mock('../crypto', () => ({
  decryptSlackToken: (...args: unknown[]) => decryptSlackTokenMock(...args),
}))

vi.mock('../prompt', () => ({
  buildSlackPrompt: (...args: unknown[]) => buildSlackPromptMock(...args),
}))

vi.mock('../service-user', () => ({
  ensureSlackServiceUser: (...args: unknown[]) => ensureSlackServiceUserMock(...args),
}))

vi.mock('@/lib/services', () => ({
  slackService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    findThreadBinding: (...args: unknown[]) => findThreadBindingMock(...args),
    markEventReceived: (...args: unknown[]) => markEventReceivedMock(...args),
    markLastError: (...args: unknown[]) => markLastErrorMock(...args),
    markSocketConnected: (...args: unknown[]) => markSocketConnectedMock(...args),
    recordEventReceipt: (...args: unknown[]) => recordEventReceiptMock(...args),
    upsertThreadBinding: (...args: unknown[]) => upsertThreadBindingMock(...args),
  },
}))

describe('slack socket manager', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    appInstances.length = 0
    const { stopSlackSocketManager } = await import('../socket-mode')
    stopSlackSocketManager()
    decryptSlackTokenMock.mockImplementation((value: string) => value)
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
    recordEventReceiptMock.mockResolvedValue(true)
    findThreadBindingMock.mockResolvedValue(null)
    ensureSlackServiceUserMock.mockResolvedValue({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    ensureWorkspaceRunningForExecutionMock.mockResolvedValue(undefined)
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
  })

  it('starts a socket-mode app for an enabled integration', async () => {
    const { syncSlackSocketManager, stopSlackSocketManager } = await import('../socket-mode')

    await syncSlackSocketManager()

    expect(appConstructorMock).toHaveBeenCalledTimes(1)
    expect(appInstances[0].start).toHaveBeenCalledTimes(1)

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

    recordEventReceiptMock.mockResolvedValueOnce(false)
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
})
