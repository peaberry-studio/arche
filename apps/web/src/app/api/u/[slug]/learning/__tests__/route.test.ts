import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLearningRun: vi.fn(),
  dispatchLearningRunExecution: vi.fn(),
  findLearningRunForUser: vi.fn(),
  listLearningProposals: vi.fn(),
  listLearningRuns: vi.fn(),
}))

vi.mock('@/lib/learning/service', () => ({
  createLearningRun: mocks.createLearningRun,
  dispatchLearningRunExecution: mocks.dispatchLearningRunExecution,
  findLearningRunForUser: mocks.findLearningRunForUser,
  listLearningProposals: mocks.listLearningProposals,
  listLearningRuns: mocks.listLearningRuns,
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: NextRequest, context: { slug: string; user: { id: string } }) => Promise<Response>) => {
    return (request: NextRequest) => handler(request, { slug: 'alice', user: { id: 'user-1' } })
  },
}))

import { GET, POST } from '../route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/u/alice/learning', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const createdRun = {
  id: 'run-1',
  sourceSessionId: 'session-1',
  title: 'Session',
  trigger: 'manual',
  status: 'pending',
}

describe('/api/u/[slug]/learning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLearningRuns.mockResolvedValue([{ id: 'run-1' }])
    mocks.listLearningProposals.mockResolvedValue([{ id: 'proposal-1' }])
    mocks.createLearningRun.mockResolvedValue({ ok: true, run: createdRun })
  })

  it('lists learning runs and proposals', async () => {
    const response = await GET(new NextRequest('http://localhost/api/u/alice/learning'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ runs: [{ id: 'run-1' }], proposals: [{ id: 'proposal-1' }] })
  })

  it('creates a manual learning run and dispatches the executor', async () => {
    const response = await POST(makeRequest({ sourceSessionId: 'session-1', title: 'Session' }))

    expect(response.status).toBe(200)
    expect(mocks.createLearningRun).toHaveBeenCalledWith({
      userId: 'user-1',
      slug: 'alice',
      sourceSessionId: 'session-1',
      title: 'Session',
      trigger: 'manual',
    })
    expect(mocks.dispatchLearningRunExecution).toHaveBeenCalledWith({
      runId: 'run-1',
      slug: 'alice',
      userId: 'user-1',
      sourceSessionId: 'session-1',
      title: 'Session',
      trigger: 'manual',
    })
  })

  it('returns create errors', async () => {
    mocks.createLearningRun.mockResolvedValue({ ok: false, error: 'instance_unavailable' })

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'instance_unavailable' })
    expect(mocks.dispatchLearningRunExecution).not.toHaveBeenCalled()
  })

  it('re-dispatches a failed run on retry', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({ ...createdRun, status: 'failed', trigger: 'auto' })

    const response = await POST(makeRequest({ runId: 'run-1' }))

    expect(response.status).toBe(200)
    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ runId: 'run-1', userId: 'user-1' })
    expect(mocks.dispatchLearningRunExecution).toHaveBeenCalledWith({
      runId: 'run-1',
      slug: 'alice',
      userId: 'user-1',
      sourceSessionId: 'session-1',
      title: 'Session',
      trigger: 'auto',
    })
    expect(mocks.createLearningRun).not.toHaveBeenCalled()
  })

  it('rejects retrying a run that is already executing', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({ ...createdRun, status: 'running' })

    const response = await POST(makeRequest({ runId: 'run-1' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'run_not_retryable' })
    expect(mocks.dispatchLearningRunExecution).not.toHaveBeenCalled()
  })

  it('rejects retrying an unknown run', async () => {
    mocks.findLearningRunForUser.mockResolvedValue(null)

    const response = await POST(makeRequest({ runId: 'run-missing' }))

    expect(response.status).toBe(404)
    expect(mocks.dispatchLearningRunExecution).not.toHaveBeenCalled()
  })
})
