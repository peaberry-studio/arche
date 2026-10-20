import { FlowRunStatus } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureSessionMessageCursor: vi.fn(),
  describeLatestAssistantReply: vi.fn(),
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

vi.mock('@/lib/harness/execution', () => ({
  captureSessionMessageCursor: mocks.captureSessionMessageCursor,
  describeLatestAssistantReply: mocks.describeLatestAssistantReply,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR: 'execution_termination_unconfirmed',
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
  listAgents: ReturnType<typeof vi.fn>
  listModels: ReturnType<typeof vi.fn>
  listConnectorKeys: ReturnType<typeof vi.fn>
  listConnectorStatus: ReturnType<typeof vi.fn>
  sessionStatus: ReturnType<typeof vi.fn>
  abortSession: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
}

function createClient(params: {
  agents?: unknown[]
  config?: unknown
  mcpStatus?: unknown
  providers?: unknown[]
} = {}): TestFlowPromptClient {
  return {
    listAgents: vi.fn().mockResolvedValue({ ok: true, data: params.agents ?? [] }),
    listModels: vi.fn().mockResolvedValue({ ok: true, data: params.providers ?? [] }),
    listConnectorKeys: vi.fn().mockResolvedValue({ ok: true, data: params.config ?? [] }),
    listConnectorStatus: vi.fn().mockResolvedValue({ ok: true, data: params.mcpStatus ?? {} }),
    sessionStatus: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    abortSession: vi.fn(),
    prompt: vi.fn().mockResolvedValue({ ok: true }),
  } as TestFlowPromptClient
}

describe('runFlowPromptAndReadOutput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureSessionMessageCursor.mockResolvedValue({ messageCount: 3 })
    mocks.waitForSessionToComplete.mockResolvedValue({ status: 'completed' })
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

    expect(client.prompt).toHaveBeenCalledWith(
      {
        agent: 'writer',
        parts: [{ text: 'Do work', type: 'text' }],
        sessionId: 'session-1',
      },
    )
    expect(mocks.readLatestAssistantText).toHaveBeenCalledWith(client, 'session-1', { messageCount: 3 })
  })

  it('records message run usage when an execution user is provided', async () => {
    const client = createClient()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockImplementation(async (input) => {
      await input.readRuntimeSessionState()
      return { ok: true, run: { id: 'message-run-1' } }
    })
    mocks.waitForSessionToComplete.mockImplementation(async (params) => {
      expect(params.usage).toEqual({ messageRunId: 'message-run-1', source: 'flow', userId: 'user-1' })
      return { status: 'completed' }
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
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'busy' } } })
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
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'session_busy' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
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
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_run_cancelled' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
    expect(client.abortSession).not.toHaveBeenCalled()
  })

  it('fails before sending when the target agent model is unavailable', async () => {
    const client = createClient({
      agents: [{ model: { providerId: 'opencode', modelId: 'missing-model' }, id: 'writer' }],
      providers: [{ providerId: 'opencode', modelId: 'big-pickle' }],
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
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_agent_model_unavailable:writer:opencode/missing-model' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
  })

  it('continues when runtime agent metadata cannot be read', async () => {
    const client = createClient()
    client.listAgents.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })

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

  it('skips the MCP gate entirely when no connectors are declared', async () => {
    const client = createClient({
      config: ['arche_custom_mixpanel'],
      mcpStatus: {
        arche_custom_mixpanel: false,
      },
    })

    await expect(runFlowPromptAndReadOutput({
      agent: null,
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })
    await expect(runFlowPromptAndReadOutput({
      agent: null,
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      requiredConnectors: [],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })

    expect(client.listConnectorKeys).not.toHaveBeenCalled()
    expect(client.listConnectorStatus).not.toHaveBeenCalled()
    expect(client.prompt).toHaveBeenCalled()
  })

  it('waits for declared MCP connectors before sending the prompt', async () => {
    const client = createClient({
      config: ['arche_custom_mixpanel'],
    })
    client.listConnectorStatus
      .mockResolvedValueOnce({ ok: true, data: { arche_custom_mixpanel: false } })
      .mockResolvedValueOnce({ ok: true, data: { arche_custom_mixpanel: true } })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessInitialDelayMs: 1,
      mcpReadinessTimeoutMs: 50,
      prompt: 'Do work',
      requiredConnectors: [{ displayName: 'Mixpanel', id: 'mixpanel' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: true, output: 'assistant output' })

    expect(client.listConnectorStatus).toHaveBeenCalledTimes(2)
    expect(client.prompt).toHaveBeenCalled()
  })

  it('returns an explicit declared-connector error when MCP readiness times out', async () => {
    const client = createClient({
      config: ['arche_custom_mixpanel'],
      mcpStatus: {
        arche_custom_mixpanel: false,
      },
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessTimeoutMs: 0,
      prompt: 'Do work',
      requiredConnectors: [{ displayName: 'Mixpanel', id: 'mixpanel' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_mcp_connector_unavailable:Mixpanel' })

    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
  })

  it('falls back to the server key when a declared connector has no display name', async () => {
    const client = createClient({
      config: ['arche_custom_mixpanel'],
      mcpStatus: {
        arche_custom_mixpanel: false,
      },
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessTimeoutMs: 0,
      prompt: 'Do work',
      requiredConnectors: [{ id: 'mixpanel' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_mcp_connector_unavailable:arche_custom_mixpanel' })
  })

  it('returns the declared id as unavailable when it is absent from the runtime config', async () => {
    const client = createClient({
      config: ['arche_custom_other'],
      mcpStatus: {},
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessTimeoutMs: 0,
      prompt: 'Do work',
      requiredConnectors: [{ id: 'missingcuid' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_mcp_connector_unavailable:missingcuid' })

    expect(client.prompt).not.toHaveBeenCalled()
  })

  it('returns declared-connector unavailability when MCP status does not answer', async () => {
    vi.useFakeTimers()
    const client = createClient({
      config: ['arche_custom_mixpanel'],
    })
    client.listConnectorStatus.mockReturnValue(new Promise(() => undefined))

    const resultPromise = runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessStatusTimeoutMs: 1,
      mcpReadinessTimeoutMs: 0,
      prompt: 'Do work',
      requiredConnectors: [{ displayName: 'Mixpanel', id: 'mixpanel' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })

    await vi.advanceTimersByTimeAsync(1)

    await expect(resultPromise).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_mcp_connector_unavailable:Mixpanel' })
    expect(mocks.captureSessionMessageCursor).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
  })

  it('stops polling declared-connector readiness after the maximum attempts', async () => {
    vi.useFakeTimers()
    const client = createClient({
      config: ['arche_custom_mixpanel'],
      mcpStatus: {
        arche_custom_mixpanel: false,
      },
    })

    const resultPromise = runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      mcpReadinessInitialDelayMs: 1,
      mcpReadinessMaxAttempts: 2,
      mcpReadinessTimeoutMs: 1_000,
      prompt: 'Do work',
      requiredConnectors: [{ displayName: 'Mixpanel', id: 'mixpanel' }],
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })

    await vi.advanceTimersByTimeAsync(1)

    await expect(resultPromise).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_mcp_connector_unavailable:Mixpanel' })
    expect(client.listConnectorStatus).toHaveBeenCalledTimes(2)
    expect(client.prompt).not.toHaveBeenCalled()
  })

  it('returns cancellation to the shared session waiter', async () => {
    const client = createClient()
    mocks.findRunStatusById
      .mockResolvedValueOnce({ status: FlowRunStatus.running })
      .mockResolvedValueOnce({ status: FlowRunStatus.cancelled })
    mocks.waitForSessionToComplete.mockImplementation(async (params: { onPulse?: () => Promise<string | null | void> }) => {
      const result = await params.onPulse?.()
      return result ? { status: 'failed', error: result } : { status: 'completed' }
    })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_run_cancelled' })

    expect(client.abortSession).not.toHaveBeenCalled()
    expect(mocks.extendFlowLease).not.toHaveBeenCalled()
    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('extends the flow lease while waiting for completion', async () => {
    mocks.waitForSessionToComplete.mockImplementation(async (params: { onPulse?: () => Promise<string | null | void> }) => {
      await params.onPulse?.()
      return { status: 'completed' }
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
      return result ? { status: 'failed', error: result } : { status: 'completed' }
    })

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_lease_lost' })

    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('returns completion failures without reading output', async () => {
    mocks.waitForSessionToComplete.mockResolvedValue({ status: 'failed', error: 'flow_run_timeout' })

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_run_timeout' })

    expect(mocks.readLatestAssistantText).not.toHaveBeenCalled()
  })

  it('marks tracked message runs failed when prompt dispatch fails', async () => {
    const client = createClient()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' } } })
    client.prompt.mockRejectedValue(new Error('prompt failed'))
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

  it('settles a tracked message run after a typed prompt rejection', async () => {
    const client = createClient()
    client.prompt.mockResolvedValue({ ok: false, error: { code: 'session_not_found' } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })

    await expect(runFlowPromptAndReadOutput({
      client, flowId: 'flow-1', leaseOwner: 'worker-1', prompt: 'Do work',
      runId: 'run-1', sessionId: 'session-1', slug: 'alice', userId: 'user-1',
    })).rejects.toThrow('session_not_found')
    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('message-run-1', 'session_not_found')
    expect(mocks.waitForSessionToComplete).not.toHaveBeenCalled()
  })

  it('marks tracked message runs failed when completion returns a failure reason', async () => {
    const client = createClient()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })
    mocks.waitForSessionToComplete.mockResolvedValue({ status: 'failed', error: 'flow_run_timeout' })

    await expect(runFlowPromptAndReadOutput({
      client,
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'user-1',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_run_timeout' })

    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('message-run-1', 'flow_run_timeout')
  })

  it('fails tracked message runs when termination is unconfirmed', async () => {
    const client = createClient()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' } } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })
    mocks.waitForSessionToComplete.mockResolvedValue({
      status: 'termination_unconfirmed',
      cause: 'flow_run_timeout',
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
    })).resolves.toEqual({
      ok: false,
      type: 'termination_unconfirmed',
      cause: 'flow_run_timeout',
    })

    // The flow run stays preserved for lease-expiry recovery, but this
    // message run is definitively over — leaving it `running` would block
    // provider syncs until the 35-minute timeout.
    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('message-run-1', 'flow_run_timeout')
  })

  it('returns a self-describing error when no assistant output is available', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.readLatestAssistantText.mockResolvedValue(null)
    mocks.describeLatestAssistantReply.mockResolvedValue({
      agent: 'repository-analyst',
      assistantMessageCount: 1,
      messageCount: 2,
      modelId: 'glm-5.2',
      partTypes: ['reasoning', 'step-finish'],
      providerId: 'openrouter',
    })

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({
      ok: false,
      type: 'failed',
      error: 'flow_no_assistant_output:openrouter/glm-5.2:reasoning+step-finish',
    })
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[flows] Step completed without assistant output',
      expect.objectContaining({ agent: 'repository-analyst', modelId: 'glm-5.2' }),
    )

    consoleWarnSpy.mockRestore()
  })

  it('returns the plain no-output error when diagnostics are unavailable', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.readLatestAssistantText.mockResolvedValue(null)
    mocks.describeLatestAssistantReply.mockRejectedValue(new Error('instance unavailable'))

    await expect(runFlowPromptAndReadOutput({
      client: createClient(),
      flowId: 'flow-1',
      leaseOwner: 'worker-1',
      prompt: 'Do work',
      runId: 'run-1',
      sessionId: 'session-1',
      slug: 'alice',
    })).resolves.toEqual({ ok: false, type: 'failed', error: 'flow_no_assistant_output' })

    consoleWarnSpy.mockRestore()
  })
})

describe('createFlowLeaseOwner', () => {
  it('creates a process-scoped lease owner id', async () => {
    await expect(createFlowLeaseOwner()).resolves.toMatch(new RegExp(`^flows:${process.pid}:[0-9a-f-]{36}$`))
  })
})
