import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimLearningRunForExecution: vi.fn(),
  markLearningRunFailed: vi.fn(),
  markLearningRunSucceeded: vi.fn(),
  setLearningRunInternalSessionId: vi.fn(),
  createInstanceClient: vi.fn(),
  ensureWorkspaceRunningForExecution: vi.fn(),
  createSessionPromptRun: vi.fn(),
  captureSessionMessageCursor: vi.fn(),
  waitForSessionToComplete: vi.fn(),
  markRunFailed: vi.fn(),
  markRunSucceeded: vi.fn(),
}))

vi.mock('@/lib/learning/repository', () => ({
  claimLearningRunForExecution: mocks.claimLearningRunForExecution,
  markLearningRunFailed: mocks.markLearningRunFailed,
  markLearningRunSucceeded: mocks.markLearningRunSucceeded,
  setLearningRunInternalSessionId: mocks.setLearningRunInternalSessionId,
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: mocks.createInstanceClient,
}))

vi.mock('@/lib/opencode/session-execution', () => ({
  ensureWorkspaceRunningForExecution: mocks.ensureWorkspaceRunningForExecution,
  createSessionPromptRun: mocks.createSessionPromptRun,
  captureSessionMessageCursor: mocks.captureSessionMessageCursor,
  waitForSessionToComplete: mocks.waitForSessionToComplete,
}))

vi.mock('@/lib/services', () => ({
  messageRunService: {
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
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: 'internal-session-1' } }),
      promptAsync: vi.fn().mockResolvedValue({ data: {} }),
    },
  }
}

describe('executeLearningRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimLearningRunForExecution.mockResolvedValue(true)
    mocks.markLearningRunFailed.mockResolvedValue(undefined)
    mocks.markLearningRunSucceeded.mockResolvedValue(undefined)
    mocks.setLearningRunInternalSessionId.mockResolvedValue(undefined)
    mocks.markRunFailed.mockResolvedValue(undefined)
    mocks.markRunSucceeded.mockResolvedValue(undefined)
    mocks.ensureWorkspaceRunningForExecution.mockResolvedValue(undefined)
    mocks.createInstanceClient.mockResolvedValue(makeClient())
    mocks.createSessionPromptRun.mockResolvedValue({ ok: true, run: { id: 'message-run-1' } })
    mocks.captureSessionMessageCursor.mockResolvedValue({ messageCount: 0 })
    mocks.waitForSessionToComplete.mockResolvedValue(null)
  })

  it('runs the curator in a hidden session and marks the run succeeded', async () => {
    const client = makeClient()
    mocks.createInstanceClient.mockResolvedValue(client)

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: true })

    expect(mocks.claimLearningRunForExecution).toHaveBeenCalledWith('run-1')
    expect(mocks.ensureWorkspaceRunningForExecution).toHaveBeenCalledWith('alice', 'user-1')
    expect(client.session.create).toHaveBeenCalledWith(
      { title: 'Learning | Source session' },
      { throwOnError: true },
    )
    expect(mocks.setLearningRunInternalSessionId).toHaveBeenCalledWith({
      runId: 'run-1',
      internalSessionId: 'internal-session-1',
    })
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'internal-session-1',
        parts: [expect.objectContaining({ type: 'text' })],
      }),
      { throwOnError: true },
    )
    expect(mocks.waitForSessionToComplete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'internal-session-1',
      slug: 'alice',
      usage: { messageRunId: 'message-run-1', source: 'learning', userId: 'user-1' },
    }))
    expect(mocks.markRunSucceeded).toHaveBeenCalledWith('message-run-1')
    expect(mocks.markLearningRunSucceeded).toHaveBeenCalledWith('run-1')
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
  })

  it('stores the real failure when the curator session fails', async () => {
    mocks.waitForSessionToComplete.mockResolvedValue('APIError: Provider returned error 400')

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

  it('does not execute a run another dispatch already claimed', async () => {
    mocks.claimLearningRunForExecution.mockResolvedValue(false)

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'run_not_claimable' })

    expect(mocks.ensureWorkspaceRunningForExecution).not.toHaveBeenCalled()
    expect(mocks.markLearningRunFailed).not.toHaveBeenCalled()
  })

  it('marks the run failed when the instance is unavailable', async () => {
    mocks.createInstanceClient.mockResolvedValue(null)

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'instance_unavailable' })

    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({ runId: 'run-1', error: 'instance_unavailable' })
  })

  it('marks the run failed when the workspace cannot start', async () => {
    mocks.ensureWorkspaceRunningForExecution.mockRejectedValue(new Error('instance_start_timeout'))

    await expect(executeLearningRun(baseInput)).resolves.toEqual({ ok: false, error: 'instance_start_timeout' })

    expect(mocks.markLearningRunFailed).toHaveBeenCalledWith({ runId: 'run-1', error: 'instance_start_timeout' })
  })
})

describe('buildCuratorPrompt', () => {
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
})
