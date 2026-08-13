import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortActiveRun: vi.fn(),
  auditEvent: vi.fn(),
  cancelLearningRun: vi.fn(),
  createInstanceClient: vi.fn(),
  findIdBySlug: vi.fn(),
  findLearningRunForUser: vi.fn(),
  abortSessionFamilyAndConfirmIdle: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/learning/service', () => ({
  cancelLearningRun: mocks.cancelLearningRun,
  findLearningRunForUser: mocks.findLearningRunForUser,
}))

vi.mock('@/lib/services/user', () => ({ findIdBySlug: mocks.findIdBySlug }))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: mocks.createInstanceClient,
}))

vi.mock('@/lib/opencode/session-execution', () => ({
  abortSessionFamilyAndConfirmIdle: mocks.abortSessionFamilyAndConfirmIdle,
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
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
    mocks.findLearningRunForUser.mockResolvedValue(runningRun)
    mocks.cancelLearningRun.mockResolvedValue({ ...runningRun, status: 'cancelled' })
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.abortActiveRun.mockResolvedValue(undefined)
    mocks.abortSessionFamilyAndConfirmIdle.mockResolvedValue(true)
    mocks.createInstanceClient.mockResolvedValue({
      session: {
        abort: vi.fn().mockResolvedValue({ data: {} }),
      },
    })
  })

  it('cancels an active run and confirms its internal session family is idle', async () => {
    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ run: { ...runningRun, status: 'cancelled' } })
    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.cancelLearningRun).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.createInstanceClient).toHaveBeenCalledWith('alice')
    const client = await mocks.createInstanceClient.mock.results[0].value
    expect(mocks.abortSessionFamilyAndConfirmIdle).toHaveBeenCalledWith({
      client,
      rootSessionId: 'internal-session-1',
    })
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
    expect(mocks.abortSessionFamilyAndConfirmIdle).toHaveBeenCalledWith({
      client,
      rootSessionId: 'late-session',
    })
    expect(mocks.abortActiveRun).toHaveBeenCalledWith('alice', 'late-session')
  })

  it('keeps cancellation successful without releasing the active run when termination is unconfirmed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = { session: {} }
    mocks.createInstanceClient.mockResolvedValue(client)
    mocks.abortSessionFamilyAndConfirmIdle.mockResolvedValue(false)

    try {
      const response = await POST(makeRequest(), routeContext())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ run: { ...runningRun, status: 'cancelled' } })
      expect(mocks.abortSessionFamilyAndConfirmIdle).toHaveBeenCalledWith({
        client,
        rootSessionId: 'internal-session-1',
      })
      expect(mocks.abortActiveRun).not.toHaveBeenCalled()
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

  it('cancels the workspace owner run for admin cross-slug requests', async () => {
    mocks.findIdBySlug.mockResolvedValue({ id: 'alice-owner' })

    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(200)
    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ runId: 'run-1', userId: 'alice-owner' })
    expect(mocks.cancelLearningRun).toHaveBeenCalledWith({ runId: 'run-1', userId: 'alice-owner' })
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1' }))
  })

  it('rejects the request when the workspace owner cannot be resolved', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)

    const response = await POST(makeRequest(), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'workspace_owner_not_found' })
    expect(mocks.findLearningRunForUser).not.toHaveBeenCalled()
    expect(mocks.cancelLearningRun).not.toHaveBeenCalled()
  })
})
