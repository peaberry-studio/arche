import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
    appInstances.length = 0
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
})
