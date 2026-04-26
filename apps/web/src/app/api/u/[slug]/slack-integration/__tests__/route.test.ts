import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, slackIntegration: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  requireCapability: vi.fn(() => null),
  auditEvent: vi.fn(),
  loadSlackAgentOptions: vi.fn(),
  decryptSlackToken: vi.fn(),
  encryptSlackToken: vi.fn(),
  isSlackBotToken: vi.fn(),
  isSlackAppToken: vi.fn(),
  serializeSlackIntegration: vi.fn(),
  testSlackCredentials: vi.fn(),
  ensureSlackServiceUser: vi.fn(),
  syncSlackSocketManager: vi.fn(),
  slackService: {
    findIntegration: vi.fn(),
    saveIntegrationConfig: vi.fn(),
    clearIntegration: vi.fn(),
  },
}))

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

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: mocks.requireCapability,
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/slack/agents', () => ({
  loadSlackAgentOptions: mocks.loadSlackAgentOptions,
}))

vi.mock('@/lib/slack/crypto', () => ({
  decryptSlackToken: mocks.decryptSlackToken,
  encryptSlackToken: mocks.encryptSlackToken,
}))

vi.mock('@/lib/slack/integration', () => ({
  isSlackBotToken: mocks.isSlackBotToken,
  isSlackAppToken: mocks.isSlackAppToken,
  serializeSlackIntegration: mocks.serializeSlackIntegration,
  testSlackCredentials: mocks.testSlackCredentials,
}))

vi.mock('@/lib/slack/service-user', () => ({
  ensureSlackServiceUser: mocks.ensureSlackServiceUser,
}))

vi.mock('@/lib/slack/socket-mode', () => ({
  syncSlackSocketManager: mocks.syncSlackSocketManager,
}))

vi.mock('@/lib/services', () => ({
  slackService: mocks.slackService,
}))

import { DELETE, GET, PUT } from '../route'

const ADMIN_SESSION = {
  user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'session-1',
}

const USER_SESSION = {
  user: { id: 'u-user', email: 'user@test.com', slug: 'user', role: 'USER' },
  sessionId: 'session-2',
}

const FAKE_AGENTS = [
  { id: 'agent-1', displayName: 'Primary Agent', isPrimary: true },
  { id: 'agent-2', displayName: 'Secondary Agent', isPrimary: false },
]

const FAKE_INTEGRATION_SUMMARY = {
  enabled: true,
  status: 'connected' as const,
  configured: true,
  hasBotToken: true,
  hasAppToken: true,
  slackTeamId: 'T123',
  slackAppId: 'A123',
  slackBotUserId: 'U123',
  defaultAgentId: 'agent-1',
  resolvedDefaultAgentId: 'agent-1',
  lastError: null,
  lastSocketConnectedAt: null,
  lastEventAt: null,
  version: 1,
  updatedAt: '2026-04-01T00:00:00.000Z',
}

const FAKE_EXISTING_INTEGRATION = {
  enabled: true,
  botTokenSecret: 'encrypted-bot',
  appTokenSecret: 'encrypted-app',
  defaultAgentId: 'agent-1',
  slackTeamId: 'T123',
  slackAppId: 'A123',
  slackBotUserId: 'U123',
}

function makeGetRequest() {
  return new NextRequest('http://localhost/api/u/admin/slack-integration', {
    method: 'GET',
  })
}

function makePutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/admin/slack-integration', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function makePutRequestRaw(rawBody: string) {
  return new NextRequest('http://localhost/api/u/admin/slack-integration', {
    method: 'PUT',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function makeDeleteRequest() {
  return new NextRequest('http://localhost/api/u/admin/slack-integration', {
    method: 'DELETE',
    headers: {
      origin: 'http://localhost',
    },
  })
}

function slugParams(slug = 'admin') {
  return { params: Promise.resolve({ slug }) }
}

function setupAgentOptions(ok = true) {
  if (ok) {
    mocks.loadSlackAgentOptions.mockResolvedValue({
      ok: true,
      agents: FAKE_AGENTS,
      primaryAgentId: 'agent-1',
    })
  } else {
    mocks.loadSlackAgentOptions.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })
  }
}

describe('/api/u/[slug]/slack-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, slackIntegration: true })
    mocks.isDesktop.mockReturnValue(false)
    mocks.requireCapability.mockReturnValue(null)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.serializeSlackIntegration.mockReturnValue(FAKE_INTEGRATION_SUMMARY)
    mocks.syncSlackSocketManager.mockResolvedValue(undefined)
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.ensureSlackServiceUser.mockResolvedValue({ ok: true })
    mocks.isSlackBotToken.mockImplementation((t: string) => t.startsWith('xoxb-'))
    mocks.isSlackAppToken.mockImplementation((t: string) => t.startsWith('xapp-'))
    mocks.encryptSlackToken.mockImplementation((t: string) => `enc:${t}`)
    mocks.decryptSlackToken.mockImplementation((t: string) => t.replace('enc:', ''))
    mocks.testSlackCredentials.mockResolvedValue({
      teamId: 'T123',
      appId: 'A123',
      botUserId: 'U123',
    })
    mocks.slackService.findIntegration.mockResolvedValue(null)
    mocks.slackService.saveIntegrationConfig.mockResolvedValue(undefined)
    mocks.slackService.clearIntegration.mockResolvedValue(undefined)
    setupAgentOptions(true)
  })

  describe('GET', () => {
    it('returns integration settings for admin', async () => {
      mocks.slackService.findIntegration.mockResolvedValue(FAKE_EXISTING_INTEGRATION)

      const res = await GET(makeGetRequest(), slugParams())

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.agents).toEqual(FAKE_AGENTS)
      expect(json.integration).toEqual(FAKE_INTEGRATION_SUMMARY)
      expect(mocks.loadSlackAgentOptions).toHaveBeenCalled()
      expect(mocks.slackService.findIntegration).toHaveBeenCalled()
      expect(mocks.serializeSlackIntegration).toHaveBeenCalledWith(
        FAKE_EXISTING_INTEGRATION,
        'agent-1',
      )
    })

    it('returns 403 for non-admin', async () => {
      mocks.getSession.mockResolvedValue(USER_SESSION)

      const res = await GET(
        new NextRequest('http://localhost/api/u/user/slack-integration', { method: 'GET' }),
        slugParams('user'),
      )

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('forbidden')
    })

    it('returns 503 when agent options kb_unavailable', async () => {
      setupAgentOptions(false)
      mocks.slackService.findIntegration.mockResolvedValue(null)

      const res = await GET(makeGetRequest(), slugParams())

      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('kb_unavailable')
    })
  })

  describe('PUT', () => {
    it('creates integration with valid tokens', async () => {
      mocks.slackService.findIntegration
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(FAKE_EXISTING_INTEGRATION)

      const res = await PUT(
        makePutRequest({
          botToken: 'xoxb-test-bot-token',
          appToken: 'xapp-test-app-token',
          enabled: true,
          defaultAgentId: 'agent-1',
        }),
        slugParams(),
      )

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.agents).toEqual(FAKE_AGENTS)
      expect(json.integration).toEqual(FAKE_INTEGRATION_SUMMARY)

      expect(mocks.slackService.saveIntegrationConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          botTokenSecret: 'xoxb-test-bot-token',
          appTokenSecret: 'xapp-test-app-token',
          enabled: true,
          defaultAgentId: 'agent-1',
          slackTeamId: 'T123',
          slackAppId: 'A123',
          slackBotUserId: 'U123',
          clearLastError: true,
        }),
      )

      expect(mocks.testSlackCredentials).toHaveBeenCalledWith({
        appToken: 'xapp-test-app-token',
        botToken: 'xoxb-test-bot-token',
      })

      expect(mocks.syncSlackSocketManager).toHaveBeenCalledWith(false)

      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'u-admin',
        action: 'slack_integration.updated',
        metadata: {
          defaultAgentId: 'agent-1',
          enabled: true,
          reconnect: false,
          tokensChanged: true,
        },
      })
    })

    it('rejects invalid bot token not starting with xoxb-', async () => {
      const res = await PUT(
        makePutRequest({
          botToken: 'invalid-bot-token',
          appToken: 'xapp-test-app-token',
          enabled: true,
        }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_bot_token')
      expect(json.message).toBe('Bot token must start with xoxb-.')
    })

    it('rejects invalid app token not starting with xapp-', async () => {
      const res = await PUT(
        makePutRequest({
          botToken: 'xoxb-test-bot-token',
          appToken: 'invalid-app-token',
          enabled: true,
        }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_app_token')
      expect(json.message).toBe('App token must start with xapp-.')
    })

    it('rejects non-admin', async () => {
      mocks.getSession.mockResolvedValue(USER_SESSION)

      const res = await PUT(
        new NextRequest('http://localhost/api/u/user/slack-integration', {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost',
          },
        }),
        slugParams('user'),
      )

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('forbidden')
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await PUT(makePutRequestRaw('{not valid json'), slugParams())

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_json')
    })

    it('handles reconnect flag', async () => {
      mocks.slackService.findIntegration
        .mockResolvedValueOnce(FAKE_EXISTING_INTEGRATION)
        .mockResolvedValueOnce(FAKE_EXISTING_INTEGRATION)

      const res = await PUT(
        makePutRequest({ reconnect: true }),
        slugParams(),
      )

      expect(res.status).toBe(200)
      expect(mocks.syncSlackSocketManager).toHaveBeenCalledWith(true)
      expect(mocks.testSlackCredentials).toHaveBeenCalled()
      expect(mocks.ensureSlackServiceUser).toHaveBeenCalled()
    })

    it('returns 400 for cannot_reconnect_disabled', async () => {
      mocks.slackService.findIntegration.mockResolvedValue({
        ...FAKE_EXISTING_INTEGRATION,
        enabled: false,
      })

      const res = await PUT(
        makePutRequest({ reconnect: true, enabled: false }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('cannot_reconnect_disabled')
    })

    it('returns 400 for missing_tokens when enabling without tokens', async () => {
      mocks.slackService.findIntegration.mockResolvedValue(null)

      const res = await PUT(
        makePutRequest({ enabled: true }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('missing_tokens')
    })

    it('returns 400 for slack_test_failed', async () => {
      mocks.slackService.findIntegration.mockResolvedValue(null)
      mocks.testSlackCredentials.mockRejectedValue(new Error('invalid_auth'))

      const res = await PUT(
        makePutRequest({
          botToken: 'xoxb-test-bot-token',
          appToken: 'xapp-test-app-token',
          enabled: true,
        }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('slack_test_failed')
      expect(json.message).toBe('invalid_auth')
    })

    it('returns 400 for unknown_agent defaultAgentId', async () => {
      const res = await PUT(
        makePutRequest({
          defaultAgentId: 'nonexistent-agent',
          enabled: false,
        }),
        slugParams(),
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('unknown_agent')
    })
  })

  describe('DELETE', () => {
    it('clears integration and audits', async () => {
      mocks.slackService.findIntegration.mockResolvedValue(null)

      const res = await DELETE(makeDeleteRequest(), slugParams())

      expect(res.status).toBe(200)
      expect(mocks.slackService.clearIntegration).toHaveBeenCalled()
      expect(mocks.syncSlackSocketManager).toHaveBeenCalled()
      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'u-admin',
        action: 'slack_integration.deleted',
      })
    })

    it('returns 403 for non-admin', async () => {
      mocks.getSession.mockResolvedValue(USER_SESSION)

      const res = await DELETE(
        new NextRequest('http://localhost/api/u/user/slack-integration', {
          method: 'DELETE',
          headers: { origin: 'http://localhost' },
        }),
        slugParams('user'),
      )

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('forbidden')
    })
  })
})
