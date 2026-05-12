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
  validateAutopilotTaskPayload: vi.fn(),
  triggerAutopilotTaskNow: vi.fn(),
  serializeAutopilotTaskDetail: vi.fn((t: unknown) => t),
  serializeAutopilotTaskListItem: vi.fn((t: unknown) => t),
  autopilotService: {
    listTasksByUserId: vi.fn(),
    createTask: vi.fn(),
    findTaskByIdAndUserId: vi.fn(),
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
}))

vi.mock('@/lib/autopilot/payload', () => ({
  validateAutopilotTaskPayload: mocks.validateAutopilotTaskPayload,
}))

vi.mock('@/lib/autopilot/runner', () => ({
  triggerAutopilotTaskNow: mocks.triggerAutopilotTaskNow,
}))

vi.mock('@/lib/autopilot/serializers', () => ({
  serializeAutopilotTaskDetail: mocks.serializeAutopilotTaskDetail,
  serializeAutopilotTaskListItem: mocks.serializeAutopilotTaskListItem,
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

import { GET, POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SESSION_ALICE = {
  user: { id: 'u-alice', email: 'alice@test.com', slug: 'alice', role: 'USER' as const },
  sessionId: 'session-1',
}

function makeGetRequest(slug: string) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot`, {
    method: 'GET',
  })
}

function makePostRequest(slug: string, body: unknown) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function makePostRequestRaw(slug: string, rawBody: string) {
  return new NextRequest(`http://localhost/api/u/${slug}/autopilot`, {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function slugParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('/api/u/[slug]/autopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION_ALICE)
    mocks.getRuntimeCapabilities.mockReturnValue({ autopilot: true, csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.requireCapability.mockReturnValue(null)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
  })

  // -----------------------------------------------------------------------
  // GET
  // -----------------------------------------------------------------------
  describe('GET', () => {
    it('lists tasks for the authenticated user', async () => {
      const tasks = [makeFakeTask(), makeFakeTask({ id: 'task-2', name: 'Second' })]
      mocks.autopilotService.listTasksByUserId.mockResolvedValue(tasks)
      mocks.serializeAutopilotTaskListItem.mockImplementation((t: { id: string }) => ({ id: t.id }))

      const res = await GET(makeGetRequest('alice'), slugParams('alice'))

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.tasks).toHaveLength(2)
      expect(mocks.autopilotService.listTasksByUserId).toHaveBeenCalledWith('u-alice')
      expect(mocks.serializeAutopilotTaskListItem).toHaveBeenCalledTimes(2)
    })

    it('returns 404 when the slug does not match any user', async () => {
      // Authenticated as alice but requesting bob's tasks — alice is not admin
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-alice', email: 'alice@test.com', slug: 'alice', role: 'ADMIN' },
        sessionId: 'session-1',
      })
      mocks.userService.findIdBySlug.mockResolvedValue(null)

      const res = await GET(makeGetRequest('unknown'), slugParams('unknown'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 401 when there is no session', async () => {
      mocks.getSession.mockResolvedValue(null)

      const res = await GET(makeGetRequest('alice'), slugParams('alice'))

      expect(res.status).toBe(401)
    })
  })

  // -----------------------------------------------------------------------
  // POST
  // -----------------------------------------------------------------------
  describe('POST', () => {
    const validPayload = {
      name: 'New Task',
      prompt: 'Run a report',
      targetAgentId: null,
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
    }

    beforeEach(() => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: validPayload,
      })

      const createdTask = makeFakeTask({ id: 'task-new' })
      mocks.autopilotService.createTask.mockResolvedValue(createdTask)
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(createdTask)
      mocks.slackService.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
      mocks.slackService.listEnabledNotificationChannels.mockResolvedValue([
        { channelId: 'C123', isPrivate: false, name: 'general' },
        { channelId: 'G123', isPrivate: true, name: 'private-team' },
      ])
      mocks.userService.findTeamMemberById.mockResolvedValue({ id: 'u-bob' })
      mocks.triggerAutopilotTaskNow.mockResolvedValue({ ok: true })
      mocks.serializeAutopilotTaskDetail.mockImplementation((t: { id: string }) => ({ id: t.id }))
    })

    it('creates a task, audits, and triggers the initial run', async () => {
      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.task).toBeDefined()
      expect(json.task.id).toBe('task-new')

      expect(mocks.autopilotService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-alice',
          name: 'New Task',
          prompt: 'Run a report',
          cronExpression: '0 9 * * *',
          timezone: 'UTC',
          enabled: true,
        }),
      )

      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'u-alice',
          action: 'autopilot.task_created',
          metadata: expect.objectContaining({ taskId: 'task-new' }),
        }),
      )

      expect(mocks.triggerAutopilotTaskNow).toHaveBeenCalledWith({
        taskId: 'task-new',
        trigger: 'on_create',
        userId: 'u-alice',
      })
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await POST(
        makePostRequestRaw('alice', '{not valid json'),
        slugParams('alice'),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_json')
    })

    it('returns the validation error when payload validation fails', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: false,
        error: 'invalid_name',
        status: 400,
      })

      const res = await POST(
        makePostRequest('alice', { prompt: 'missing name' }),
        slugParams('alice'),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_name')
    })

    it('returns 409 on P2002 unique constraint violation', async () => {
      mocks.autopilotService.createTask.mockRejectedValue(
        new mocks.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      )

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('task_name_exists')
    })

    it('handles trigger failure gracefully and still returns 201', async () => {
      mocks.triggerAutopilotTaskNow.mockResolvedValue({
        ok: false,
        error: 'task_busy',
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(201)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[autopilot] Failed to trigger initial task run',
        expect.objectContaining({ reason: 'task_busy' }),
      )

      consoleSpy.mockRestore()
    })

    it('handles trigger throwing an error gracefully and still returns 201', async () => {
      mocks.triggerAutopilotTaskNow.mockRejectedValue(new Error('network down'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(201)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[autopilot] Unexpected error triggering initial task run',
        expect.objectContaining({ error: expect.any(Error) }),
      )

      consoleSpy.mockRestore()
    })

    it('does not trigger the initial run when the task is disabled', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: { ...validPayload, enabled: false },
      })

      const disabledTask = makeFakeTask({ id: 'task-disabled', enabled: false })
      mocks.autopilotService.createTask.mockResolvedValue(disabledTask)
      mocks.autopilotService.findTaskByIdAndUserId.mockResolvedValue(disabledTask)

      const res = await POST(makePostRequest('alice', { ...validPayload, enabled: false }), slugParams('alice'))

      expect(res.status).toBe(201)
      expect(mocks.triggerAutopilotTaskNow).not.toHaveBeenCalled()
    })

    it('returns 404 when the slug does not resolve to a user', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
        sessionId: 'session-1',
      })
      mocks.userService.findIdBySlug.mockResolvedValue(null)

      const res = await POST(makePostRequest('nonexistent', validPayload), slugParams('nonexistent'))

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('rejects non-admin Slack DM notification targets for other users', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: {
          ...validPayload,
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'dm', userId: 'u-bob' }],
          },
        },
      })

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'slack_notification_dm_target_forbidden' })
      expect(mocks.autopilotService.createTask).not.toHaveBeenCalled()
    })

    it('rejects non-admin Slack notification targets for private channels', async () => {
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: {
          ...validPayload,
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'channel', channelId: 'G123' }],
          },
        },
      })

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'slack_notification_channel_target_forbidden' })
      expect(mocks.autopilotService.createTask).not.toHaveBeenCalled()
    })

    it('allows admin Slack notification targets for team members and private channels', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
        sessionId: 'session-admin',
      })
      mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u-alice' })
      mocks.validateAutopilotTaskPayload.mockResolvedValue({
        ok: true,
        value: {
          ...validPayload,
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [
              { type: 'dm', userId: 'u-bob' },
              { type: 'channel', channelId: 'G123' },
            ],
          },
        },
      })

      const res = await POST(makePostRequest('alice', validPayload), slugParams('alice'))

      expect(res.status).toBe(201)
      expect(mocks.userService.findTeamMemberById).toHaveBeenCalledWith('u-bob')
      expect(mocks.autopilotService.createTask).toHaveBeenCalled()
    })
  })
})
