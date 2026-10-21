import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime, message, session } from '@/lib/harness/__tests__/fake-runtime'
import type { HarnessMessage } from '@/lib/harness/contract'
import {
  abortSessionFamilyAndConfirmIdle,
  captureSessionMessageCursor,
  createSessionPromptRun,
  describeLatestAssistantReply,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/harness/execution'
import { syncRuntimeProviderAccess } from '@/lib/harness/registry'
import { getWorkspaceStatus, startWorkspace } from '@/lib/runtime/workspace-host'
import { messageRunService } from '@/lib/services'

const mocks = vi.hoisted(() => ({ touch: vi.fn(), usage: vi.fn(), credential: vi.fn() }))

vi.mock('@/lib/harness/registry', () => ({ syncRuntimeProviderAccess: vi.fn() }))
vi.mock('@/lib/runtime/workspace-host', () => ({ getWorkspaceStatus: vi.fn(), startWorkspace: vi.fn() }))
vi.mock('@/lib/services', () => ({
  instanceService: { touchActivity: (...args: unknown[]) => mocks.touch(...args) },
  messageRunService: { createActiveRunAfterRuntimeStateCheck: vi.fn() },
  providerUsageService: { recordProviderRunUsage: (...args: unknown[]) => mocks.usage(...args) },
}))
vi.mock('@/lib/providers/store', () => ({ getEffectiveCredentialForUser: (...args: unknown[]) => mocks.credential(...args) }))

describe('harness execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.touch.mockResolvedValue(undefined)
    mocks.usage.mockResolvedValue({ ok: true, recorded: true })
    mocks.credential.mockResolvedValue({ source: 'user', credential: { id: 'cred-1', type: 'api', secret: 'enc', version: 1 } })
    vi.mocked(syncRuntimeProviderAccess).mockResolvedValue({ ok: true, data: undefined })
  })

  afterEach(() => { vi.useRealTimers() })

  it('captures the current message count', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ role: 'user' }), message()] })
    expect(await captureSessionMessageCursor(client, 'session-1')).toEqual({ messageCount: 2 })
  })

  it('does not read stale assistant text before the cursor', async () => {
    expect(await readLatestAssistantText(fakeRuntime(), 'session-1', { messageCount: 1 })).toBeNull()
  })

  it('returns only visible assistant text, excluding reasoning', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ parts: [{ type: 'reasoning', text: 'Internal' }, { type: 'text', text: 'Final reply' }] })] })
    expect(await readLatestAssistantText(client, 'session-1')).toBe('Final reply')
  })

  it('skips non-assistant messages while reading the latest text', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message(), message({ role: 'user', parts: [{ type: 'text', text: 'User' }] })] })
    expect(await readLatestAssistantText(client, 'session-1')).toBe('Done')
  })

  it.each([
    ['old assistant', [message()], { messageCount: 1 }],
    ['only non-assistant', [message({ role: 'user' })], undefined],
  ] as const)('reports no assistant after the idle grace period: %s', async (_name, data, cursor) => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [...data] })
    const promise = waitForSessionToComplete({ client, cursor, sessionId: 'session-1', slug: 'slack-bot' })
    await vi.advanceTimersByTimeAsync(16_000)
    expect(await promise).toEqual({ status: 'failed', error: 'flow_no_assistant_message' })
    expect(client.listMessages).toHaveBeenCalledTimes(1)
    expect(client.sessionStatus.mock.calls.length).toBeGreaterThan(1)
  })

  it.each([
    ['provider auth missing', { code: 'provider_auth_missing', detail: 'ProviderAuthError: API key is missing' }, 'provider_auth_missing'],
    ['provider credential configuration', { code: 'provider_auth_missing', detail: 'RuntimeError: Configure the openrouter provider' }, 'provider_auth_missing'],
    ['aborted', { code: 'runtime_error', detail: 'MessageAbortedError: The operation was aborted.' }, 'MessageAbortedError: The operation was aborted.'],
    ['provider 400', { code: 'runtime_error', detail: 'APIError: Provider returned error 400: invalid schema' }, 'APIError: Provider returned error 400: invalid schema'],
  ] satisfies Array<[string, NonNullable<HarnessMessage['error']>, string]>)('surfaces normalized assistant errors: %s', async (_name, error, expected) => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ parts: [], error })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })).toEqual({ status: 'failed', error: expected })
  })

  it('tolerates unrelated assistant errors when visible output exists', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ error: { code: 'runtime_error', detail: 'RuntimeError: Model overloaded' } })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })).toEqual({ status: 'completed' })
  })

  it('records provider usage from normalized step-finish parts', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ role: 'user' }), message({
      model: { providerId: 'openai', modelId: ' gpt-5.5 ' },
      parts: [
        { type: 'step-finish', id: 'f1', reason: 'end_turn', cost: 0.25, tokens: { input: 100, output: 50 } },
        { type: 'step-finish', id: 'f2', reason: 'end_turn', cost: 0.5, tokens: { input: 20, output: 30 } },
      ],
    })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot', usage: { messageRunId: 'message-run-1', source: 'flow', userId: 'user-1' } })).toEqual({ status: 'completed' })
    await vi.waitFor(() => expect(mocks.usage).toHaveBeenCalledWith({
      costUsd: 0.75, credentialSource: 'user', inputTokens: 120, messageRunId: 'message-run-1', modelId: 'gpt-5.5', outputTokens: 80, providerId: 'openai', source: 'flow', userId: 'user-1',
    }))
  })

  it('does not record usage without a supported provider or billable tokens', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ model: { providerId: 'unknown-provider', modelId: 'model' }, parts: [{ type: 'step-finish', id: 'f1', reason: '', cost: 0, tokens: { input: 0, output: 0 } }] })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot', usage: { messageRunId: 'r1', source: 'flow', userId: 'u1' } })).toEqual({ status: 'completed' })
    expect(mocks.usage).not.toHaveBeenCalled()
  })

  it('completes when idle even if a tool still has running state', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ parts: [{ type: 'tool', id: 't1', name: 'read_file', state: { status: 'running', input: {}, title: 'reading' } }] })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })).toEqual({ status: 'completed' })
    expect(client.listMessages).toHaveBeenCalledTimes(1)
  })

  it('only fetches messages once status becomes idle', async () => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    client.sessionStatus.mockResolvedValueOnce({ ok: true, data: { 'session-1': { type: 'busy' } } })
      .mockResolvedValueOnce({ ok: true, data: { 'session-1': { type: 'retry' } } })
    const promise = waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(await promise).toEqual({ status: 'completed' })
    expect(client.listMessages).toHaveBeenCalledTimes(1)
  })

  it('returns the latest tool error', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ parts: [{ type: 'tool', id: 't1', name: 'bash', state: { status: 'error', input: {}, error: 'permission denied' } }] })] })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })).toEqual({ status: 'failed', error: 'permission denied' })
  })

  it.each([undefined, true])('refreshes provider access on an already running workspace (force=%s)', async (force) => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue({ status: 'running' } as never)
    await ensureWorkspaceRunningForExecution('slack-bot', 'user-1', { forceProviderRefresh: force })
    expect(syncRuntimeProviderAccess).toHaveBeenCalledWith('slack-bot', { userId: 'user-1', force })
  })

  it('refreshes provider access after a starting workspace becomes running', async () => {
    vi.useFakeTimers()
    vi.mocked(getWorkspaceStatus).mockResolvedValueOnce({ status: 'starting' } as never).mockResolvedValueOnce({ status: 'running' } as never)
    const promise = ensureWorkspaceRunningForExecution('slack-bot', 'user-1')
    await vi.advanceTimersByTimeAsync(2_000)
    await promise
    expect(syncRuntimeProviderAccess).toHaveBeenCalledWith('slack-bot', { userId: 'user-1' })
  })

  it('times out if a workspace never finishes starting', async () => {
    vi.useFakeTimers()
    vi.mocked(getWorkspaceStatus).mockResolvedValue({ status: 'starting' } as never)
    const promise = ensureWorkspaceRunningForExecution('slack-bot', 'user-1')
    const expectation = expect(promise).rejects.toThrow('instance_start_timeout')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    await expectation
  })

  it('starts a stopped workspace and refreshes access', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue({ status: 'stopped' } as never)
    vi.mocked(startWorkspace).mockResolvedValue({ ok: true } as never)
    await ensureWorkspaceRunningForExecution('slack-bot', 'user-1')
    expect(startWorkspace).toHaveBeenCalledWith('slack-bot', 'user-1')
    expect(syncRuntimeProviderAccess).toHaveBeenCalledWith('slack-bot', { userId: 'user-1' })
  })

  it('surfaces workspace startup failures', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue({ status: 'stopped' } as never)
    vi.mocked(startWorkspace).mockResolvedValue({ ok: false, error: 'insufficient_capacity', detail: 'No resources' } as never)
    await expect(ensureWorkspaceRunningForExecution('slack-bot', 'user-1')).rejects.toThrow('No resources')
  })

  it('returns a confirmed timeout failure', async () => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    let aborted = false
    client.abortSession.mockImplementation(async () => { aborted = true; return { ok: true, data: undefined } })
    client.sessionStatus.mockImplementation(async () => ({ ok: true, data: { 'session-1': { type: aborted ? 'idle' : 'busy' } } }))
    const promise = waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot' })
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000)
    expect(await promise).toEqual({ status: 'failed', error: 'flow_run_timeout' })
    expect(client.abortSession).toHaveBeenCalledWith('session-1')
  })

  it('aborts descendants before the root and confirms idle', async () => {
    const client = fakeRuntime()
    client.listChildren.mockResolvedValueOnce({ ok: true, data: [session('child-1')] }).mockResolvedValueOnce({ ok: true, data: [session('grandchild-1')] })
    expect(await abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })).toBe(true)
    expect(client.abortSession.mock.calls.map(([id]) => id)).toEqual(['grandchild-1', 'child-1', 'session-1'])
  })

  it('does not confirm termination while a child remains busy', async () => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    client.listChildren.mockResolvedValueOnce({ ok: true, data: [session('child-1')] })
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' }, 'child-1': { type: 'busy' } } })
    const promise = abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await promise).toBe(false)
    expect(client.abortSession.mock.calls.map(([id]) => id)).toEqual(['child-1', 'session-1'])
  })

  it('aborts a descendant that appears while the family is stopping before confirming idle', async () => {
    const client = fakeRuntime()
    client.listChildren.mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValueOnce({ ok: true, data: [session('late-child')] })
    expect(await abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })).toBe(true)
    expect(client.abortSession.mock.calls.map(([id]) => id)).toEqual(['session-1', 'late-child'])
  })

  it.each([true, false])('retries an abort the adapter could not confirm (eventually confirmed=%s)', async (eventually) => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    const unconfirmed = { ok: false as const, error: { code: 'execution_termination_unconfirmed' as const } }
    if (eventually) client.abortSession.mockResolvedValueOnce(unconfirmed)
    else client.abortSession.mockResolvedValue(unconfirmed)
    const promise = abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await promise).toBe(eventually)
    expect(client.abortSession.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not confirm termination when descendant discovery fails', async () => {
    const client = fakeRuntime()
    client.listChildren.mockResolvedValue({ ok: false, error: { code: 'runtime_error', detail: 'children unavailable' } })
    expect(await abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })).toBe(false)
    expect(client.abortSession).toHaveBeenCalledWith('session-1')
    expect(client.sessionStatus).not.toHaveBeenCalled()
  })

  it('handles abort rejections after the confirmation deadline without leaking rejections', async () => {
    vi.useFakeTimers()
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)
    try {
      const client = fakeRuntime()
      client.listChildren.mockReturnValue(new Promise(() => undefined))
      client.abortSession.mockRejectedValue(new Error('runtime unavailable'))
      const promise = abortSessionFamilyAndConfirmIdle({ client, rootSessionId: 'session-1' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await promise).toBe(false)
      await Promise.resolve()
      expect(client.abortSession).toHaveBeenCalledWith('session-1')
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandledRejection)
    }
  })

  it.each([true, false])('aborts on pulse failure and preserves its cause (confirmed=%s)', async (confirmed) => {
    const client = fakeRuntime()
    if (!confirmed) client.listChildren.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    expect(await waitForSessionToComplete({ client, sessionId: 'session-1', slug: 'slack-bot', onPulse: vi.fn().mockResolvedValue('flow_run_cancelled') })).toEqual(confirmed ? { status: 'failed', error: 'flow_run_cancelled' } : { status: 'termination_unconfirmed', cause: 'flow_run_cancelled' })
    expect(client.abortSession).toHaveBeenCalledWith('session-1')
  })

  it('calls onPulse during execution', async () => {
    const onPulse = vi.fn().mockResolvedValue(undefined)
    await waitForSessionToComplete({ client: fakeRuntime(), sessionId: 'session-1', slug: 'slack-bot', onPulse })
    expect(onPulse).toHaveBeenCalled()
  })

  it('describes the latest normalized assistant reply', async () => {
    const client = fakeRuntime()
    client.listMessages.mockResolvedValue({ ok: true, data: [message({ agentId: 'reviewer', model: { providerId: 'openai', modelId: 'gpt-5.5' } })] })
    expect(await describeLatestAssistantReply({ client, sessionId: 'session-1' })).toEqual({ agent: 'reviewer', assistantMessageCount: 1, messageCount: 1, modelId: 'gpt-5.5', partTypes: ['text'], providerId: 'openai' })
  })

  it.each(['busy', 'retry', 'idle', 'unknown'] as const)('admits a run only for idle family status: %s', async (type) => {
    const client = fakeRuntime()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type } } })
    const result = await createSessionPromptRun({ client, sessionId: 'session-1', slug: 'slack-bot', source: 'flow' })
    if (type !== 'idle') {
      expect(result).toEqual({ ok: false, error: 'session_busy', activeRun: null })
      expect(messageRunService.createActiveRunAfterRuntimeStateCheck).not.toHaveBeenCalled()
      return
    }
    const input = vi.mocked(messageRunService.createActiveRunAfterRuntimeStateCheck).mock.calls[0]?.[0]
    expect(await input?.readRuntimeSessionState()).toBe('idle')
  })

  it.each(['busy', 'retry'] as const)('rejects a %s grandchild before creating a run', async (type) => {
    const client = fakeRuntime()
    client.listChildren.mockResolvedValueOnce({ ok: true, data: [session('child-1')] })
      .mockResolvedValueOnce({ ok: true, data: [session('grandchild-1')] })
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' }, 'grandchild-1': { type } } })
    expect(await createSessionPromptRun({ client, sessionId: 'session-1', slug: 'slack-bot', source: 'flow' }))
      .toEqual({ ok: false, error: 'session_busy', activeRun: null })
    expect(messageRunService.createActiveRunAfterRuntimeStateCheck).not.toHaveBeenCalled()
    expect(client.prompt).not.toHaveBeenCalled()
    expect(client.listChildren).toHaveBeenCalledWith('grandchild-1')
  })

  it('bounds incomplete family discovery without creating a run', async () => {
    vi.useFakeTimers()
    const client = fakeRuntime()
    client.listChildren.mockReturnValue(new Promise(() => undefined))
    const pending = createSessionPromptRun({ client, sessionId: 'session-1', slug: 'slack-bot', source: 'flow' })
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await pending).toEqual({ ok: false, error: 'session_busy', activeRun: null })
    expect(messageRunService.createActiveRunAfterRuntimeStateCheck).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a missing root rather than reporting it busy', async () => {
    const client = fakeRuntime()
    client.listChildren.mockResolvedValue({ ok: false, error: { code: 'session_not_found' } })
    expect(await createSessionPromptRun({ client, sessionId: 'missing', slug: 'slack-bot', source: 'flow' }))
      .toEqual({ ok: false, error: 'session_not_found' })
    expect(messageRunService.createActiveRunAfterRuntimeStateCheck).not.toHaveBeenCalled()
  })
})
