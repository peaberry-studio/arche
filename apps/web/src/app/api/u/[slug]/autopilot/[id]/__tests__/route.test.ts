import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ autopilot: true, csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  requireCapability: vi.fn(() => null),
  auditEvent: vi.fn(),
  validateDesktopToken: vi.fn(() => true),
  getNextAutopilotRunAt: vi.fn(() => new Date('2026-05-01T00:00:00Z')),
  validateAutopilotCronExpression: vi.fn(() => '0 9 * * *'),
  validateAutopilotTaskPayload: vi.fn(),
  serializeAutopilotTaskDetail: vi.fn((t: unknown) => t),
  autopilotService: {
    findTaskByIdAndUserId: vi.fn(),
    updateTaskByIdAndUserId: vi.fn(),
    deleteTaskByIdAndUserId: vi.fn(),
  },
  slackService: {
    findIntegration: vi.fn(),
    listEnabledNotificationChannels: vi.fn(),
  },
  userService: {
    findIdBySlug: vi.fn(),
    findTeamMemberById: vi.fn(),
  },
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
    code: string
    clientVersion: string
    constructor(message: string, { code, clientVersion }: { code: string; clientVersion: string }) {
      super(message)
      this.code = code
      this.clientVersion = clientVersion
      this.name = 'PrismaClientKnownRequestError'
    }
  },
}))

// ---------------------------------------------------------------------------
// vi.mock() declarations — withAuth is NOT mocked
// ---------------------------------------------------------------------------
vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: mocks.getRuntimeCapabilities,
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: mocks.isDesktop,
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: mocks.validateSameOrigin,
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: mocks.requireCapability,
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))

vi.mock('@/lib/autopilot/cron', () => ({
  getNextAutopilotRunAt: mocks.getNextAutopilotRunAt,
  validateAutopilotCronExpression: mocks.validateAutopilotCronExpression,
}))

vi.mock('@/lib/autopilot/payload', () => ({
  validateAutopilotTaskPayload: mocks.validateAutopilotTaskPayload,
}))

vi.mock('@/lib/autopilot/serializers', () => ({
  serializeAutopilotTaskDetail: mocks.serializeAutopilotTaskDetail,
}))

vi.mock('@/lib/services', () => ({
  autopilotService: mocks.autopilotService,
  slackService: mocks.slackService,
  userService: mocks.userService,
}))

vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: mocks.PrismaClientKnownRequestError,
  },
}))

import { DELETE, GET, PATCH } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SESSION_ALICE = {
  user: { id: 'u-alice', email: 'alice@test.com', slug: 'alice', role: 'USER' as const },
  sessionId: 'session-1',
}

const now = new Date('2026-04-25T12:00:00Z')

function makeFakeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId: 'u-alice',
    name: 'My Task',
    prompt: 'Do something',
    targetAgentId: null,
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: now,
    lastRunAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    runs: [],
    ...overrides,
  }
}

function makeGetRequest(slug: string, id: string) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot/${id}`, {
    method: 'GET',
  })
}

function makePatchRequest(slug: string, id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function makePatchRequestRaw(slug: string, id: string, rawBody: string) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot/${id}`, {
    method: 'PATCH',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function makeDeleteRequest(slug: string, id: string) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot/${id}`, {
    method: 'DELETE',
    headers: {
      origin: 'http://localhost',
    },
  })
}

function idParams(slug: string, id: string) {
  return { params: Promise.resolve({ slug, id }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('/api/u/[slug]/autopilot/[id]', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION_ALICE)
    mocks.getRuntimeCapabilities.mockReturnValue({ autopilot: true, csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.requireCapability.mockReturnValue(null)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateAutopilotCronExpression.mockReturnValue('0 9 * * *')
    mocks.getNextAutopilotRunAt.mockReturnValue(new Date('2026-05-01T00:00:00Z'))
    mocks.serializeAutopilotTaskDetail.mockImplementation((t: unknown) => t)
  })

  // -----------------------------------------------------------------------
  // GET
  // -----------------------------------------------------------------------
  describe('GET', () => {
    it('returns task detail for a valid task', async () => {
      const task = makeFakeTask()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(task)
      mocks.serializeAutopilotTaskDetail.mockImplementation((t: { id: string }) => ({ id: t.id }))

      const res = await GET(makeGetRequest('alice', 'task-1'), idParams('alice', 'task-1'))

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.task).toBeDefined()
      expect(json.task.id).toBe('task-1')
      expect(mocks.autopilotService.findTaskByIdAndUserId).toHaveBeenCalledWith('task-1', 'u-alice')
    })

    it('returns 404 when the task does not exist', async () => {
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(null)

      const res = await GET(makeGetRequest('alice', 'nonexistent'), idParams('alice', 'nonexistent'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 404 when the slug does not resolve to a user', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
        sessionId: 'session-1',
      })
      mocks.userService.findIdBySlug.mockResolvedValue(null)

      const res = await GET(makeGetRequest('unknown', 'task-1'), idParams('unknown', 'task-1'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 401 when there is no session', async () => {
      mocks.getSession.mockResolvedValue(null)

      const res = await GET(makeGetRequest('alice', 'task-1'), idParams('alice', 'task-1'))

      expect(res.status).toBe(401)
    })
  })

  // -----------------------------------------------------------------------
  // PATCH
  // -----------------------------------------------------------------------
  describe('PATCH', () => {
    const existingTask = makeFakeTask()

    beforeEach(() => {
      mocks.autopilotService.findTaskByIdAndUserId
        .mockResolvedValueOnce(existingTask) // first call — check existing
        .mockResolvedValueOnce(existingTask) // second call — after update detail

      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: { name: 'Updated Task' },
      })

      mocks.autopilotService.updateTaskByIdAndUserId.mockResolvedValue(existingTask)
      mocks.slackService.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
      mocks.slackService.listEnabledNotificationChannels.mockResolvedValue([
        { channelId: 'C123', isPrivate: false, name: 'general' },
        { channelId: 'G123', isPrivate: true, name: 'private-team' },
      ])
      mocks.userService.findTeamMemberById.mockResolvedValue({ id: 'u-bob' })
      mocks.serializeAutopilotTaskDetail.mockImplementation((t: { id: string }) => ({ id: t.id }))
    })

    it('updates a task and returns the detail', async () => {
      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { name: 'Updated Task' }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.task).toBeDefined()

      expect(mocks.autopilotService.updateTaskByIdAndUserId).toHaveBeenCalledWith(
        'task-1',
        'u-alice',
        expect.objectContaining({ name: 'Updated Task' }),
      )
      expect(mocks.autopilotService.updateTaskByIdAndUserId.mock.calls[0][2]).not.toHaveProperty('slackNotificationConfig')

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-alice',
          action: 'autopilot.task_updated',
          metadata: expect.objectContaining({ taskId: 'task-1' }),
        }),
      )
    })

    it('returns 400 for invalid JSON', async () => {
      // Reset findTaskByIdAndUserId to return a value for the existing-check
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(existingTask)

      const res = await PATCH(
        makePatchRequestRaw('alice', 'task-1', '{not valid json'),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_json')
    })

    it('returns the validation error when payload validation fails', async () => {
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(existingTask)

      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: false,
        error: 'invalid_name',
        status: 400,
      })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { name: '' }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_name')
    })

    it('returns 404 when the task does not exist (pre-check)', async () => {
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(null)

      const res = await PATCH(
        makePatchRequest('alice', 'nonexistent', { name: 'Updated' }),
        idParams('alice', 'nonexistent'),
      )

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 409 on P2002 unique constraint violation', async () => {
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(existingTask)

      mocks.autopilotService.updateTaskByIdAndUserId.mockRejectedValue(
        new mocks.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      )

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { name: 'Duplicate Name' }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('task_name_exists')
    })

    it('returns 400 when cron expression validation throws', async () => {
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(existingTask)

      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: { cronExpression: 'bad cron' },
      })
      mocks.validateAutopilotCronExpression.mockImplementation(() => {
        throw new Error('invalid')
      })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { cronExpression: 'bad cron' }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_cron_expression')
    })

    it('recalculates nextRunAt when enabled changes', async () => {
      const disabledTask = makeFakeTask({ enabled: false })
      mocks.autopilotService.findTaskByIdAndUserId.mockReset()
      mocks.autopilotService.findTaskByIdAndUserId
        .mockResolvedValueOnce(disabledTask) // existing check
        .mockResolvedValueOnce({ ...disabledTask, enabled: true }) // detail fetch after update

      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: { enabled: true },
      })

      mocks.autopilotService.updateTaskByIdAndUserId.mockResolvedValue({ ...disabledTask, enabled: true })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { enabled: true }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(200)
      expect(mocks.getNextAutopilotRunAt).toHaveBeenCalled()
      expect(mocks.autopilotService.updateTaskByIdAndUserId).toHaveBeenCalledWith(
        'task-1',
        'u-alice',
        expect.objectContaining({
          enabled: true,
          nextRunAt: expect.any(Date),
        }),
      )
    })

    it('passes null Slack notification config through for clearing', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: { slackNotificationConfig: null },
      })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { slackNotificationConfig: null }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(200)
      expect(mocks.autopilotService.updateTaskByIdAndUserId).toHaveBeenCalledWith(
        'task-1',
        'u-alice',
        expect.objectContaining({ slackNotificationConfig: null }),
      )
    })

    it('rejects non-admin Slack DM notification targets for other users', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: {
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'dm', userId: 'u-bob' }],
          },
        },
      })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { slackNotificationConfig: {} }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'slack_notification_dm_target_forbidden' })
      expect(mocks.autopilotService.updateTaskByIdAndUserId).not.toHaveBeenCalled()
    })

    it('rejects unknown Slack notification channels', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: {
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'channel', channelId: 'C999' }],
          },
        },
      })

      const res = await PATCH(
        makePatchRequest('alice', 'task-1', { slackNotificationConfig: {} }),
        idParams('alice', 'task-1'),
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'unknown_slack_notification_channel_target' })
      expect(mocks.autopilotService.updateTaskByIdAndUserId).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // DELETE
  // -----------------------------------------------------------------------
  describe('DELETE', () => {
    it('deletes the task and audits the event', async () => {
      mocks.autopilotService.deleteTaskByIdAndUserId.mockResolvedValue({ count: 1 })

      const res = await DELETE(makeDeleteRequest('alice', 'task-1'), idParams('alice', 'task-1'))

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)

      expect(mocks.autopilotService.deleteTaskByIdAndUserId).toHaveBeenCalledWith('task-1', 'u-alice')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-alice',
          action: 'autopilot.task_deleted',
          metadata: expect.objectContaining({ taskId: 'task-1' }),
        }),
      )
    })

    it('returns 404 when the task does not exist', async () => {
      mocks.autopilotService.deleteTaskByIdAndUserId.mockResolvedValue({ count: 0 })

      const res = await DELETE(makeDeleteRequest('alice', 'nonexistent'), idParams('alice', 'nonexistent'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 404 when the slug does not resolve to a user', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
        sessionId: 'session-1',
      })
      mocks.userService.findIdBySlug.mockResolvedValue(null)

      const res = await DELETE(makeDeleteRequest('unknown', 'task-1'), idParams('unknown', 'task-1'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 401 when there is no session', async () => {
      mocks.getSession.mockResolvedValue(null)

      const res = await DELETE(makeDeleteRequest('alice', 'task-1'), idParams('alice', 'task-1'))

      expect(res.status).toBe(401)
    })
  })
})
