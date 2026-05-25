import { FlowRunStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureSessionMessageCursor: vi.fn(),
  extendFlowLease: vi.fn(),
  findRunStatusById: vi.fn(),
  messageRunService: {
    createActiveRunAfterRuntimeStateCheck: vi.fn(),
    markRunFailed: vi.fn(),
    markRunSucceeded: vi.fn(),
  },
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
    findRunStatusById: mocks.findRunStatusById,
  },
  messageRunService: mocks.messageRunService,
}))

import { createFlowLeaseOwner, runFlowPromptAndReadOutput } from '@/lib/flows/session-executor'

type FlowPromptClient = Parameters<typeof runFlowPromptAndReadOutput>[0]['client']
type TestFlowPromptClient = FlowPromptClient & {
  app: { agents: ReturnType<typeof vi.fn> }
  config: { providers: ReturnType<typeof vi.fn> }
  session: FlowPromptClient['session'] & {
    abort: ReturnType<typeof vi.fn>
    promptAsync: ReturnType<typeof vi.fn>
  }
}

function createClient(params: {
  agents?: unknown[]
  providers?: unknown[]
} = {}): TestFlowPromptClient {
  return {
    app: {
      agents: vi.fn().mockResolvedValue({ data: params.agents ?? [] }),
    },
    config: {
      providers: vi.fn().mockResolvedValue({ data: { providers: params.providers ?? [] } }),
    },
    session: {
      abort: vi.fn(),
      promptAsync: vi.fn(),
    },
  } as TestFlowPromptClient
}

describe('runFlowPromptAndReadOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureSessionMessageCursor.mockResolvedValue({ messageCount: 3 })
    mocks.waitForSessionToComplete.mockResolvedValue(null)
    mocks.readLatestAssistantText.mockResolvedValue('assistant output')
    mocks.extendFlowLease.mockResolvedValue({ count: 1 })
    mocks.findRunStatusById.mockResolvedValue({ status: FlowRunStatus.running })
    mocks.messageRunService.markRunFailed.mockResolvedValue(undefined)
    mocks.messageRunService.markRunSucceeded.mockResolvedValue(undefined)
  })

  it('sends the prompt and returns the latest assistant output', async () => {
    const client = createClient()

    await expect(runFlowPromptAndReadOutput({
      agent: 'writer',
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
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

  it('records message run usage when an execution user is provided', async () => {
    const client = createClient()
    client.session.status = vi.fn().mockResolvedValue({ data: { 'session-1': { type: 'idle' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockImplementation(async (input) => {
      await input.readRuntimeSessionState()
      return { ok: true, run: { id: 'message-run-1' } }
    })
    mocks.waitForSessionToComplete.mockImplementation(async (params) => {
      expect(params.usage).toEqual({ messageRunId: 'message-run-1', source: 'flow', userId: 'user-1' })
      return null
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'user-1',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })

    expect(mocks.messageRunService.createActiveRunAfterRuntimeStateCheck).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      slug: 'alice',
      source: 'flow',
    }))
    expect(mocks.messageRunService.markRunSucceeded).toHaveBeenCalledWith('message-run-1')
  })

  it('returns session_busy when message run tracking cannot start', async () => {
    const client = createClient()
    client.session.status = vi.fn().mockResolvedValue({ data: { 'session-1': { type: 'busy' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: false, error: 'session_busy' })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'user-1',
    })).resolves.toEqual({ ok: false, error: 'session_busy' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('does not send a prompt when the run was already cancelled', async () => {
    const client = createClient()
    mocks.findRunStatusById.mockResolvedValueOnce({ status: FlowRunStatus.cancelled })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_run_cancelled' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.session.promptAsync).not.toHaveBeenCalled()
    expect(client.session.abort).not.toHaveBeenCalled()
  })

  it('fails before sending when the target agent model is unavailable', async () => {
    const client = createClient({
      agents: [{ model: { providerID: 'opencode', modelID: 'missing-model' }, name: 'writer' }],
      providers: [{ id: 'opencode', models: { 'big-pickle': {} } }],
    })

    await expect(runFlowPromptAndReadOutput({
      agent: 'writer',
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_agent_model_unavailable:writer:opencode/missing-model' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })

  it('continues when runtime agent metadata cannot be read', async () => {
    const client = createClient({ agents: [null, { model: { modelID: 9 }, name: 7 }] })
    client.app.agents.mockRejectedValue(new Error('runtime unavailable'))

    await expect(runFlowPromptAndReadOutput({
      agent: 'writer',
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })
  })

  it('aborts the OpenCode session when cancellation is detected while waiting', async () => {
    const client = createClient()
    mocks.findRunStatusById
      .mockResolvedValueOnce({ status: FlowRunStatus.running })
      .mockResolvedValueOnce({ status: FlowRunStatus.cancelled })
    mocks.waitForSessionToComplete.mockImplementation(async (params: { onPulse?: () => Promise<string | null | void> }) => {
      const result = await params.onPulse?.()
      return result ?? null
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_run_cancelled' })

    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: 'session-1' })
    expect(mocks.extendFlowLease).not.toHaveBeenCalled()
    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
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
      runId: 'run-1',
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
      runId: 'run-1',
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
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, error: 'flow_run_timeout' })

    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('marks tracked message runs failed when prompt dispatch fails', async () => {
    const client = createClient()
    client.session.status = vi.fn().mockResolvedValue({ data: { 'session-1': { type: 'idle' } } })
    client.session.promptAsync.mockRejectedValue(new Error('prompt failed'))
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'user-1',
    })).rejects.toThrow('prompt failed')

    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('message-run-1', 'prompt failed')
  })

  it('marks tracked message runs failed when completion returns a failure reason', async () => {
    const client = createClient()
    client.session.status = vi.fn().mockResolvedValue({ data: { 'session-1': { type: 'idle' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })
    mocks.waitForSessionToComplete.mockResolvedValue('flow_run_timeout')

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'user-1',
    })).resolves.toEqual({ ok: false, error: 'flow_run_timeout' })

    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('message-run-1', 'flow_run_timeout')
  })

  it('returns an error when no assistant output is available', async () => {
    mocks.readLatestAssistantText.mockResolvedValue(null)

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
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
