import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimLearningRunForExecution: vi.fn(),
  findLearningRunForUser: vi.fn(),
  markLearningRunFailed: vi.fn(),
  markLearningRunSucceeded: vi.fn(),
  setLearningRunInternalSessionId: vi.fn(),
  getRuntimeForSlug: vi.fn(),
  ensureWorkspaceRunningForExecution: vi.fn(),
  createSessionPromptRun: vi.fn(),
  captureSessionMessageCursor: vi.fn(),
  waitForSessionToComplete: vi.fn(),
  markRunFailed: vi.fn(),
  markRunAborted: vi.fn(),
  markRunSucceeded: vi.fn(),
}))

vi.mock('@/lib/learning/repository', () => ({
  claimLearningRunForExecution: mocks.claimLearningRunForExecution,
  findLearningRunForUser: mocks.findLearningRunForUser,
  markLearningRunFailed: mocks.markLearningRunFailed,
  markLearningRunSucceeded: mocks.markLearningRunSucceeded,
  setLearningRunInternalSessionId: mocks.setLearningRunInternalSessionId,
}))

vi.mock('@/lib/harness/registry', () => ({
  getRuntimeForSlug: mocks.getRuntimeForSlug,
}))

vi.mock('@/lib/harness/execution', () => ({
  ensureWorkspaceRunningForExecution: mocks.ensureWorkspaceRunningForExecution,
  createSessionPromptRun: mocks.createSessionPromptRun,
  captureSessionMessageCursor: mocks.captureSessionMessageCursor,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR: 'execution_termination_unconfirmed',
  waitForSessionToComplete: mocks.waitForSessionToComplete,
}))

vi.mock('@/lib/services', () => ({
  messageRunService: {
    markRunAborted: mocks.markRunAborted,
    markRunFailed: mocks.markRunFailed,
    markRunSucceeded: mocks.markRunSucceeded,
  },
}))

import { buildCuratorPrompt, executeLearningRun } from '@/lib/learning/run-executor'

const baseInput = {
  runId: 'run-1',
  slug: 'alice',
  userId: 'user-1',
  sourceSessionId: 'session-1',
  title: 'Source session',
  trigger: 'manual' as const,
}

function makeClient() {
  return {
    abortSession: vi.fn().mockResolvedValue({ ok: true }),
    createSession: vi.fn().mockResolvedValue({ ok: true, data: { id: 'internal-session-1' } }),
    prompt: vi.fn().mockResolvedValue({ ok: true }),
  }
}

describe('executeLearningRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimLearningRunForExecution.mockResolvedValue(true)
    mocks.markLearningRunFailed.mockResolvedValue(undefined)
    mocks.markLearningRunSucceeded.mockResolvedValue(undefined)
    mocks.setLearningRunInternalSessionId.mockResolvedValue(undefined)
    mocks.findLearningRunForUser.mockResolvedValue(null)
    mocks.markRunAborted.mockResolvedValue(undefined)
    mocks.markRunFailed.mockResolvedValue(undefined)
    mocks.markRunSucceeded.mockResolvedValue(undefined)
    mocks.ensureWorkspaceRunningForExecution.mockResolvedValue({ ok: true })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: makeClient() })
    mocks.createSessionPromptRun.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })
    mocks.captureSessionMessageCursor.mockResolvedValue({ ok: true, data: { messageCount: 0 } })
    mocks.waitForSessionToComplete.mockResolvedValue({ status: 'completed' })
  })

  it('runs the curator in a hidden session and marks the run succeeded', async () => {
    const client = makeClient()
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: client })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: true })

    expect(mocks.claimLearningRunForExecution).toHaveBeenCalledWith('run-1')
    expect(mocks.ensureWorkspaceRunningForExecution).toHaveBeenCalledWith('alice', 'user-1')
    expect(client.createSession).toHaveBeenCalledWith({ title: 'Learning | Source session' })
    expect(mocks.setLearningRunInternalSessionId).toHaveBeenCalledWith({
      runId: 'run-1',
      internalSessionId: 'internal-session-1',
    })
    expect(client.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'internal-session-1',
        parts: [expect.objectContaining({ type: 'text', text: expect.stringContaining('Set caller_session_id to "internal-session-1"') })],
      }),
    )
    expect(mocks.waitForSessionToComplete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'internal-session-1',
      slug: 'alice',
      cursor: { messageCount: 0 },
      usage: { messageRunId: 'message-run-1', source: 'learning', userId: 'user-1' },
    }))
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('message-run-1')
    expect(mocks.markLearningRunSucceeded).toHaveBeenCalledWith('run-1')
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
  })

  it('stores the real failure when the curator session fails', async () => {
    mocks.waitForSessionToComplete.mockResolvedValue({
      status: 'failed',
      error: 'APIError: Provider returned error 400',
    })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({
      ok: false,
      error: 'APIError: Provider returned error 400',
    })

    expect(mocks.markRunFailed).toHaveBeenCalledWith('message-run-1', 'APIError: Provider returned error 400')
    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({
      runId: 'run-1',
      error: 'APIError: Provider returned error 400',
    })
    expect(mocks.markLearningRunSucceeded).not.toHaveBeenCalled()
  })

  it('keeps learning and message runs active when termination is unconfirmed', async () => {
    mocks.waitForSessionToComplete.mockResolvedValue({
      status: 'termination_unconfirmed',
      cause: 'learning_run_cancelled',
    })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({
      ok: false,
      error: 'execution_termination_unconfirmed',
      cause: 'learning_run_cancelled',
    })

    expect(mocks.markRunFailed).not.toHaveBeenCalled()
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
  })

  it('does not execute a run another dispatch already claimed', async () => {
    mocks.claimLearningRunForExecution.mockResolvedValue(false)

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'run_not_claimable' })

    expect(mocks.ensureWorkspaceRunningForExecution).not.toHaveBeenCalled()
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
  })

  it('marks the run failed when the instance is unavailable', async () => {
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'instance_unavailable' })

    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({ runId: 'run-1', error: 'instance_unavailable' })
  })

  it('marks the run failed after a typed workspace startup failure', async () => {
    mocks.ensureWorkspaceRunningForExecution.mockResolvedValue({ ok: false, error: 'instance_start_timeout' })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'instance_start_timeout' })

    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({ runId: 'run-1', error: 'instance_start_timeout' })
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
    expect(mocks.markRunFailed).not.toHaveBeenCalled()
    expect(mocks.markLearningRunSucceeded).not.toHaveBeenCalled()
  })

  it.each(['cursor', 'waiter'])('settles both runs after a typed %s failure', async (stage) => {
    const client = makeClient()
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: client })
    const error = { code: 'session_not_found', detail: 'Do not replace the code' }
    if (stage === 'cursor') {
      mocks.captureSessionMessageCursor.mockResolvedValue({ ok: false, error })
    } else {
      mocks.waitForSessionToComplete.mockResolvedValue({ status: 'error', error })
    }

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'session_not_found' })

    expect(mocks.markRunFailed).toHaveBeenCalledExactlyOnceWith('message-run-1', 'session_not_found')
    expect(mocks.markLearningRunFailed).toHaveBeenCalledExactlyOnceWith({ runId: 'run-1', error: 'session_not_found' })
    expect(mocks.markRunSucceeded).not.toHaveBeenCalled()
    expect(mocks.markLearningRunSucceeded).not.toHaveBeenCalled()
    if (stage === 'cursor') {
      expect(client.prompt).not.toHaveBeenCalled()
      expect(mocks.waitForSessionToComplete).not.toHaveBeenCalled()
    }
  })

  it('settles message and learning runs after a typed prompt failure', async () => {
    const client = makeClient()
    client.prompt.mockResolvedValue({ ok: false, error: { code: 'session_not_found' } })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: client })

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'session_not_found' })
    expect(mocks.markRunFailed).toHaveBeenCalledWith('message-run-1', 'session_not_found')
    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({ runId: 'run-1', error: 'session_not_found' })
    expect(mocks.waitForSessionToComplete).not.toHaveBeenCalled()
  })

  it('returns cancellation to the shared session waiter without overwriting the run', async () => {
    const client = makeClient()
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: client })
    mocks.findLearningRunForUser.mockResolvedValue({
      ...baseInput,
      error: null,
      internalSessionId: 'internal-session-1',
      messageCount: 10,
      status: 'cancelled',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    mocks.waitForSessionToComplete.mockImplementationOnce(
      async (params: { onPulse?: () => Promise<string | null | void> }) => {
        const error = await params.onPulse?.()
        return error ? { status: 'failed', error } : { status: 'completed' }
      },
    )

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'learning_run_cancelled' })

    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(client.abortSession).not.toHaveBeenCalled()
    expect(mocks.markRunAborted).toHaveBeenCalledWith('message-run-1')
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
    expect(mocks.markLearningRunSucceeded).not.toHaveBeenCalled()
  })
})

describe('buildCuratorPrompt', () => {
  it('provides explicit MCP attribution using the current session, not the source', () => {
    const prompt = buildCuratorPrompt(baseInput, 'current-session')
    expect(prompt).toContain('caller_agent to "knowledge-curator"')
    expect(prompt).toContain('caller_session_id to "current-session"')
    expect(prompt).toContain('arche_tools_session_history_query')
    expect(prompt).toContain('arche_tools_learning_propose')
  })

  it('targets the source session when one exists', () => {
    const prompt = buildCuratorPrompt(baseInput)

    expect(prompt).toContain('sessionIds: ["session-1"]')
    expect(prompt).toContain('runId: "run-1"')
    expect(prompt).toContain('trigger: "manual"')
    expect(prompt).toContain('Never write Knowledge Base files directly')
  })

  it('reviews recent sessions when there is no source session', () => {
    const prompt = buildCuratorPrompt({ ...baseInput, sourceSessionId: null })

    expect(prompt).toContain('review the most recent sessions')
    expect(prompt).not.toContain('sessionIds:')
  })

  it('includes canonical conflict context for a linked regeneration run', () => {
    const prompt = buildCuratorPrompt({
      ...baseInput,
      sourceSessionId: null,
      regeneration: {
        actualContent: 'Current preference',
        baseContent: 'Old preference',
        changeId: 'change-1',
        kbPath: 'Preferences/Answers.md',
        operation: 'update',
        proposedContent: 'Previous proposal',
      },
    })

    expect(prompt).toContain('Knowledge Review change id: change-1')
    expect(prompt).toContain('Target path: Preferences/Answers.md')
    expect(prompt).toContain('--- Base content ---')
    expect(prompt).toContain('Old preference')
    expect(prompt).toContain('--- Current content ---')
    expect(prompt).toContain('Current preference')
    expect(prompt).toContain('--- Previous proposal ---')
    expect(prompt).toContain('Previous proposal')
  })
})
