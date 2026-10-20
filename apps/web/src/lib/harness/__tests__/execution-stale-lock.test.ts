import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime, session } from '@/lib/harness/__tests__/fake-runtime'
import { createSessionPromptRun } from '@/lib/harness/execution'
import type { MessageRunRecord } from '@/lib/services/message-run'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findLock: vi.fn(), finishRun: vi.fn(), deleteLock: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: mocks.transaction,
  messageRun: { updateMany: mocks.finishRun },
  messageRunLock: { findUnique: mocks.findLock, deleteMany: mocks.deleteLock },
} }))
vi.mock('@/lib/services', async () => ({
  instanceService: {},
  messageRunService: await import('@/lib/services/message-run'),
}))
vi.mock('@/lib/harness/registry', () => ({ syncRuntimeProviderAccess: vi.fn() }))
vi.mock('@/lib/runtime/workspace-host', () => ({ getWorkspaceStatus: vi.fn(), startWorkspace: vi.fn() }))
vi.mock('@/lib/providers/run-usage', () => ({ recordProviderRunUsageBestEffort: vi.fn() }))

const staleRun: MessageRunRecord = {
  id: 'stale-run', slug: 'slack-bot', sessionId: 'session-1', source: 'slack', status: 'running',
  error: null, startedAt: new Date(0), finishedAt: null,
}

describe('prompt-run stale-lock recovery', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each(['busy historical child', 'failed child discovery'])('recovers an idle root lock despite %s', async (scenario) => {
    const client = fakeRuntime()
    client.sessionStatus.mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' }, 'child-1': { type: 'busy' } } })
    if (scenario === 'failed child discovery') client.listChildren.mockRejectedValue(new Error('children unavailable'))
    else client.listChildren.mockResolvedValue({ ok: true, data: [session('child-1')] })
    const nextRun: MessageRunRecord = { ...staleRun, id: 'next-run' }
    mocks.transaction.mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce([{ count: 1 }, { count: 1 }])
      .mockResolvedValueOnce(nextRun)
    mocks.findLock.mockResolvedValue({ run: staleRun })
    mocks.finishRun.mockResolvedValue({ count: 1 })
    mocks.deleteLock.mockResolvedValue({ count: 1 })

    expect(await createSessionPromptRun({ client, sessionId: 'session-1', slug: 'slack-bot', source: 'slack' })).toEqual({ ok: true, run: nextRun })
    expect(mocks.finishRun).toHaveBeenCalledWith({ where: { id: 'stale-run', status: 'running' }, data: { status: 'succeeded', error: null, finishedAt: expect.any(Date) } })
    expect(mocks.deleteLock).toHaveBeenCalledWith({ where: { runId: 'stale-run' } })
    expect(client.listChildren).not.toHaveBeenCalled()
  })
})
