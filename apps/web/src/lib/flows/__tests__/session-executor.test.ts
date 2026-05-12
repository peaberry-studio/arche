import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureSessionMessageCursor: vi.fn(),
  extendFlowLease: vi.fn(),
  readLatestAssistantText: vi.fn(),
  waitForSessionToComplete: vi.fn(),
}))

vi.mock('@/lib/opencode/session-execution', () => ({
  captureSessionMessageCursor: mocks.captureSessionMessageCursor,
  readLatestAssistantText: mocks.readLatestAssistantText,
  waitForSessionToComplete: mocks.waitForSessionToComplete,
}))

vi.mock('@/lib/services', () => ({
  flowService: {
    extendFlowLease: mocks.extendFlowLease,
  },
}))

import { createFlowLeaseOwner, runFlowPromptAndReadOutput } from '@/lib/flows/session-executor'

type FlowPromptClient = Parameters<typeof runFlowPromptAndReadOutput>[0]['client']

function createClient(): FlowPromptClient {
  return {
    session: {
      promptAsync: vi.fn(),
    },
  } as FlowPromptClient
}

describe('runFlowPromptAndReadOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureSessionMessageCursor.mockResolvedValue({ messageCount: 3 })
    mocks.waitForSessionToComplete.mockResolvedValue(null)
    mocks.readLatestAssistantText.mockResolvedValue('assistant output')
    mocks.extendFlowLease.mockResolvedValue({ count: 1 })
  })

  it('sends the prompt and returns the latest assistant output', async () => {
    const client = createClient()

    await expect(runFlowPromptAndReadOutput({
      agent: 'writer',
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })

    expect(client.session.promptAsync).toHaveBeenCalledWith(
      {
        agent: 'writer',
        parts: [{ text: 'Do work', type: 'text' }],
        sessionID: 'session-1',
      },
      { throwOnError: true },
    )
    expect(mocks.readLatestAssistantText).toHaveBeenCalledWith(client, 'session-1', { messageCount: 3 })
  })

  it('extends the flow lease while waiting for completion', async () => {
    mocks.waitForSessionToComplete.mockImplementation(async (params: { onPulse?: () => Promise<string | null | void> }) => {
      await params.onPulse?.()
      return null
    })

    await runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      sessionId: 'session-1',
      slug: 'alice',
    })

    expect(mocks.extendFlowLease).toHaveBeenCalledWith('flow-1', 'worker-1', expect.any(Date))
  })

  it('fails when the flow lease can no longer be extended', async () => {
    mocks.extendFlowLease.mockResolvedValue({ count: 0 })
    mocks.waitForSessionToComplete.mockImplementation(async (params: { onPulse?: () => Promise<string | null | void> }) => {
      const result = await params.onPulse?.()
      return result ?? null
    })

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_lease_lost' })

    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('returns completion failures without reading output', async () => {
    mocks.waitForSessionToComplete.mockResolvedValue('flow_run_timeout')

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_run_timeout' })

    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('returns an error when no assistant output is available', async () => {
    mocks.readLatestAssistantText.mockResolvedValue(null)

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_no_assistant_output' })
  })
})

describe('createFlowLeaseOwner', () => {
  it('creates a process-scoped lease owner id', async () => {
    await expect(createFlowLeaseOwner()).resolves.toMatch(new RegExp(`^flows:${process.pid}:[0-9a-f-]{36}$`))
  })
})
