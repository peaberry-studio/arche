import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortActiveRun: vi.fn(),
  auditEvent: vi.fn(),
  cancelLearningRun: vi.fn(),
  createInstanceClient: vi.fn(),
  findLearningRunForUser: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/learning/service', () => ({
  cancelLearningRun: mocks.cancelLearningRun,
  findLearningRunForUser: mocks.findLearningRunForUser,
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: mocks.createInstanceClient,
}))

vi.mock('@/lib/services', () => ({
  messageRunService: {
    abortActiveRun: mocks.abortActiveRun,
  },
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (
    _options: unknown,
    handler: (
      request: NextRequest,
      context: { slug: string; params: { slug: string; runId: string }; user: { id: string } }
    ) => Promise<Response>
  ) => {
    return async (request: NextRequest, { params }: { params: Promise<{ slug: string; runId: string }> }) => {
      const resolvedParams = await params
      return handler(request, { slug: resolvedParams.slug, params: resolvedParams, user: { id: 'user-1' } })
    }
  },
}))

import { POST } from '../route'

const runningRun = {
  id: 'run-1',
  sourceSessionId: 'session-1',
  internalSessionId: 'internal-session-1',
  title: 'Session',
  trigger: 'manual',
  status: 'running',
  error: null,
  messageCount: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/u/alice/learning/runs/run-1/cancel', {
    method: 'POST',
  })
}

function routeContext(runId = 'run-1') {
  return { params: Promise.resolve({ slug: 'alice', runId }) }
}

describe('/api/u/[slug]/learning/runs/[runId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findLearningRunForUser.mockResolvedValue(runningRun)
    mocks.cancelLearningRun.mockResolvedValue({ ...runningRun, status: 'cancelled' })
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.abortActiveRun.mockResolvedValue(undefined)
    mocks.createInstanceClient.mockResolvedValue({
      session: {
        abort: vi.fn().mockResolvedValue({ data: {} }),
      },
    })
  })

  it('cancels an active run and aborts its internal session best-effort', async () => {
    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ run: { ...runningRun, status: 'cancelled' } })
    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.cancelLearningRun).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.createInstanceClient).toHaveBeenCalledWith('alice')
    const client = await mocks.createInstanceClient.mock.results[0].value
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: 'internal-session-1' })
    expect(mocks.abortActiveRun).toHaveBeenCalledWith('alice', 'internal-session-1')
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'learning.run_cancelled',
      metadata: {
        internalSessionId: 'internal-session-1',
        runId: 'run-1',
        sourceSessionId: 'session-1',
      },
    })
  })

  it('uses the persisted internal session id when cancellation wins a creation race', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({ ...runningRun, internalSessionId: null })
    mocks.cancelLearningRun.mockResolvedValue({ ...runningRun, internalSessionId: 'late-session', status: 'cancelled' })

    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(200)
    const client = await mocks.createInstanceClient.mock.results[0].value
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: 'late-session' })
    expect(mocks.abortActiveRun).toHaveBeenCalledWith('alice', 'late-session')
  })

  it('keeps cancellation successful when runtime aborts fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = {
      session: {
        abort: vi.fn().mockRejectedValue(new Error('abort failed')),
      },
    }
    mocks.createInstanceClient.mockResolvedValue(client)
    mocks.abortActiveRun.mockRejectedValue(new Error('message abort failed'))

    try {
      const response = await POST(makeRequest(), routeContext())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ run: { ...runningRun, status: 'cancelled' } })
      expect(client.session.abort).toHaveBeenCalledWith({ sessionID: 'internal-session-1' })
      expect(mocks.abortActiveRun).toHaveBeenCalledWith('alice', 'internal-session-1')
      expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'learning.run_cancelled' }))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('returns not cancelable when the guarded cancel update loses a race', async () => {
    mocks.cancelLearningRun.mockResolvedValue(null)

    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'run_not_cancelable' })
    expect(mocks.createInstanceClient).not.toHaveBeenCalled()
    expect(mocks.abortActiveRun).not.toHaveBeenCalled()
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it('returns not found for runs outside the user', async () => {
    mocks.findLearningRunForUser.mockResolvedValue(null)

    const response = await POST(makeRequest(), routeContext('run-missing'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(mocks.cancelLearningRun).not.toHaveBeenCalled()
  })

  it('rejects cancelling completed runs', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({ ...runningRun, status: 'succeeded' })

    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'run_not_cancelable' })
    expect(mocks.cancelLearningRun).not.toHaveBeenCalled()
  })
})
