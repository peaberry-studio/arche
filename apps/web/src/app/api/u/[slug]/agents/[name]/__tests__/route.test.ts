import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeSessionResult } from '@/lib/runtime/types'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn<() => Promise<RuntimeSessionResult>>()
const mockGetRuntimeCapabilities = vi.fn()
const mockIsDesktop = vi.fn(() => false)
const mockValidateDesktopToken = vi.fn(() => true)
const mockValidateSameOrigin = vi.fn(() => ({ ok: true }))
const mockReadCommonWorkspaceConfig = vi.fn()
const mockWriteCommonWorkspaceConfig = vi.fn()
const mockLoadAvailableConnectorCapabilities = vi.fn()
const mockListSkills = vi.fn()
const mockAuditEvent = vi.fn()

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => mockIsDesktop(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))

vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: (req: Request) => mockValidateSameOrigin(req),
}))

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (token: string | null) => mockValidateDesktopToken(token),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: () => mockReadCommonWorkspaceConfig(),
  writeCommonWorkspaceConfig: (content: string, hash?: string) =>
    mockWriteCommonWorkspaceConfig(content, hash),
}))

vi.mock('@/lib/agent-connector-capabilities', () => ({
  loadAvailableConnectorCapabilities: () => mockLoadAvailableConnectorCapabilities(),
}))

vi.mock('@/lib/skills/skill-store', () => ({
  listSkills: () => mockListSkills(),
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: (args: unknown) => mockAuditEvent(args),
}))

// ---------------------------------------------------------------------------
// Import SUT (after mocks)
// ---------------------------------------------------------------------------

import { DELETE, GET, PATCH } from '../route'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  default_agent: 'assistant',
  agent: {
    assistant: {
      display_name: 'Assistant',
      mode: 'primary',
      model: 'openai/gpt-5.2',
      prompt: 'You are a helpful assistant.',
      tools: { write: true, edit: true, bash: true },
    },
    researcher: {
      display_name: 'Researcher',
      mode: 'subagent',
      model: 'openai/gpt-5.2',
      description: 'Research agent',
      tools: { read: true, grep: true },
    },
  },
}

const ADMIN_USER = {
  id: 'u-admin',
  email: 'admin@test.com',
  slug: 'alice',
  role: 'ADMIN',
}

const REGULAR_USER = {
  id: 'u-user',
  email: 'user@test.com',
  slug: 'alice',
  role: 'USER',
}

function adminSession() {
  return { user: ADMIN_USER, sessionId: 'sess-admin' }
}

function regularSession() {
  return { user: REGULAR_USER, sessionId: 'sess-user' }
}

function configContent(config = TEST_CONFIG) {
  return JSON.stringify(config)
}

function makeGetRequest(name: string) {
  return new NextRequest(`http://localhost/api/u/alice/agents/${name}`, {
    method: 'GET',
  })
}

function makePatchRequest(name: string, body: unknown) {
  return new NextRequest(`http://localhost/api/u/alice/agents/${name}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

function makePatchRequestRaw(name: string, rawBody: string) {
  return new NextRequest(`http://localhost/api/u/alice/agents/${name}`, {
    method: 'PATCH',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

function makeDeleteRequest(name: string, body?: unknown) {
  const init: RequestInit = {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(`http://localhost/api/u/alice/agents/${name}`, init)
}

function routeParams(name: string) {
  return { params: Promise.resolve({ slug: 'alice', name }) }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupDefaultMocks() {
  mockIsDesktop.mockReturnValue(false)
  mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, containers: true })
  mockGetSession.mockResolvedValue(adminSession())
  mockValidateDesktopToken.mockReturnValue(true)
  mockValidateSameOrigin.mockReturnValue({ ok: true })
  mockReadCommonWorkspaceConfig.mockResolvedValue({
    ok: true,
    content: configContent(),
    hash: 'hash-1',
  })
  mockWriteCommonWorkspaceConfig.mockResolvedValue({ ok: true, hash: 'hash-2' })
  mockLoadAvailableConnectorCapabilities.mockResolvedValue([])
  mockListSkills.mockResolvedValue({ ok: true, data: [], hash: null })
  mockAuditEvent.mockResolvedValue(undefined)
}

// ---------------------------------------------------------------------------
// Tests: GET /api/u/[slug]/agents/[name]
// ---------------------------------------------------------------------------

describe('GET /api/u/[slug]/agents/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('returns agent details', async () => {
    const response = await GET(makeGetRequest('assistant'), routeParams('assistant'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent).toBeDefined()
    expect(body.agent.id).toBe('assistant')
    expect(body.agent.displayName).toBe('Assistant')
    expect(body.agent.model).toBe('openai/gpt-5.2')
    expect(body.agent.prompt).toBe('You are a helpful assistant.')
    expect(body.agent.isPrimary).toBe(true)
    expect(body.agent.capabilities).toBeDefined()
    expect(body.hash).toBe('hash-1')
  })

  it('returns 404 for missing agent', async () => {
    const response = await GET(makeGetRequest('nonexistent'), routeParams('nonexistent'))
    expect(response.status).toBe(404)

    const body = await response.json()
    expect(body.error).toBe('not_found')
  })

  it('returns 404 when config is not_found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'not_found',
    })

    const response = await GET(makeGetRequest('assistant'), routeParams('assistant'))
    expect(response.status).toBe(404)
  })

  it('returns 503 when kb_unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const response = await GET(makeGetRequest('assistant'), routeParams('assistant'))
    expect(response.status).toBe(503)
  })

  it('returns subagent details', async () => {
    const response = await GET(makeGetRequest('researcher'), routeParams('researcher'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.id).toBe('researcher')
    expect(body.agent.displayName).toBe('Researcher')
    expect(body.agent.description).toBe('Research agent')
    expect(body.agent.isPrimary).toBe(false)
  })

  it('returns default model inheritance metadata', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        default_agent: 'assistant',
        default_model: 'openai/gpt-5.5',
        agent: {
          assistant: { display_name: 'Assistant', mode: 'primary' },
          researcher: { display_name: 'Researcher', mode: 'subagent', model: 'anthropic/claude-sonnet-4' },
        },
      }),
      hash: 'hash-default',
    })

    const inheritedResponse = await GET(makeGetRequest('assistant'), routeParams('assistant'))
    const inheritedBody = await inheritedResponse.json()
    expect(inheritedBody.agent).toMatchObject({
      defaultModel: 'openai/gpt-5.5',
      resolvedModel: 'openai/gpt-5.5',
      usesDefaultModel: true,
    })

    const overrideResponse = await GET(makeGetRequest('researcher'), routeParams('researcher'))
    const overrideBody = await overrideResponse.json()
    expect(overrideBody.agent).toMatchObject({
      model: 'anthropic/claude-sonnet-4',
      resolvedModel: 'anthropic/claude-sonnet-4',
      usesDefaultModel: false,
    })
  })

  it('returns 401 when session is null', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(makeGetRequest('assistant'), routeParams('assistant'))
    expect(response.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /api/u/[slug]/agents/[name]
// ---------------------------------------------------------------------------

describe('PATCH /api/u/[slug]/agents/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('requires admin role', async () => {
    mockGetSession.mockResolvedValue(regularSession())

    const response = await PATCH(
      makePatchRequest('researcher', { displayName: 'Updated' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error).toBe('forbidden')
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await PATCH(
      makePatchRequestRaw('researcher', '{not valid json'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_json')
  })

  it('returns 404 for missing agent', async () => {
    const response = await PATCH(
      makePatchRequest('nonexistent', { displayName: 'X' }),
      routeParams('nonexistent'),
    )
    expect(response.status).toBe(404)

    const body = await response.json()
    expect(body.error).toBe('not_found')
  })

  it('validates displayName field — rejects non-string', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { displayName: 42 }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_display_name')
  })

  it('validates model field — rejects non-string', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { model: 123 }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_model')
  })

  it('validates description field — rejects non-string', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { description: true }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_description')
  })

  it('validates temperature field — rejects non-number', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { temperature: 'hot' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_temperature')
  })

  it('validates prompt field — rejects non-string', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { prompt: 123 }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_prompt')
  })

  it('updates agent displayName successfully', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { displayName: 'Updated Researcher' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.displayName).toBe('Updated Researcher')
    expect(body.agent.id).toBe('researcher')
    expect(body.hash).toBe('hash-2')

    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'u-admin',
      action: 'agent.updated',
      metadata: { slug: 'alice', agentId: 'researcher' },
    })
  })

  it('updates agent model', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { model: 'anthropic/claude-4' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.model).toBe('anthropic/claude-4')
  })

  it('clears model when set to null', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { model: null }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.model).toBeUndefined()
  })

  it('clears description when set to null', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { description: null }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.description).toBeUndefined()
  })

  it('updates temperature', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { temperature: 0.9 }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.temperature).toBe(0.9)
  })

  it('clears temperature when set to null', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { temperature: null }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.temperature).toBeUndefined()
  })

  it('updates prompt', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { prompt: 'You are a research assistant.' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.prompt).toBe('You are a research assistant.')
  })

  it('clears prompt when set to null', async () => {
    const response = await PATCH(
      makePatchRequest('assistant', { prompt: null }),
      routeParams('assistant'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.prompt).toBeUndefined()
  })

  it('updates agent with capabilities', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', {
        capabilities: {
          tools: ['write', 'edit', 'bash'],
          skillIds: [],
          mcpConnectorIds: [],
        },
      }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.capabilities).toBeDefined()
    expect(body.agent.capabilities.tools).toEqual(
      expect.arrayContaining(['bash', 'edit', 'write']),
    )
  })

  it.each([
    [
      'invalid capabilities',
      { capabilities: null },
      'invalid_capabilities',
    ],
    [
      'unknown MCP connector',
      { capabilities: { tools: [], skillIds: [], mcpConnectorIds: ['missing-connector'] } },
      'unknown_mcp_connector',
    ],
    [
      'unknown skill',
      { capabilities: { tools: [], skillIds: ['missing-skill'], mcpConnectorIds: [] } },
      'unknown_skill',
    ],
  ])('validates capability updates — rejects %s', async (_label, patch, error) => {
    const response = await PATCH(
      makePatchRequest('researcher', patch),
      routeParams('researcher'),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe(error)
  })

  it('can promote subagent to primary', async () => {
    const response = await PATCH(
      makePatchRequest('researcher', { isPrimary: true }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agent.isPrimary).toBe(true)
  })

  it('returns 409 when trying to demote the current primary agent', async () => {
    const response = await PATCH(
      makePatchRequest('assistant', { isPrimary: false }),
      routeParams('assistant'),
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('primary_required')
  })

  it('returns 404 when config not_found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'not_found',
    })

    const response = await PATCH(
      makePatchRequest('assistant', { displayName: 'X' }),
      routeParams('assistant'),
    )
    expect(response.status).toBe(404)
  })

  it('returns 503 when kb_unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const response = await PATCH(
      makePatchRequest('assistant', { displayName: 'X' }),
      routeParams('assistant'),
    )
    expect(response.status).toBe(503)
  })

  it('returns 409 when write results in conflict', async () => {
    mockWriteCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'conflict',
    })

    const response = await PATCH(
      makePatchRequest('researcher', { displayName: 'Updated' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('conflict')
  })

  it('returns 503 when listSkills fails during capabilities update', async () => {
    mockListSkills.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const response = await PATCH(
      makePatchRequest('researcher', {
        capabilities: { tools: ['read'], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE /api/u/[slug]/agents/[name]
// ---------------------------------------------------------------------------

describe('DELETE /api/u/[slug]/agents/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('requires admin role', async () => {
    mockGetSession.mockResolvedValue(regularSession())

    const response = await DELETE(
      makeDeleteRequest('researcher'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error).toBe('forbidden')
  })

  it('deletes a subagent successfully', async () => {
    const response = await DELETE(
      makeDeleteRequest('researcher'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.hash).toBe('hash-2')

    expect(mockWriteCommonWorkspaceConfig).toHaveBeenCalledOnce()
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'u-admin',
      action: 'agent.deleted',
      metadata: { slug: 'alice', agentId: 'researcher' },
    })
  })

  it('prevents deleting primary agent (by default_agent)', async () => {
    const response = await DELETE(
      makeDeleteRequest('assistant'),
      routeParams('assistant'),
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('primary_agent')
  })

  it('prevents deleting agent with mode=primary', async () => {
    // In a valid config, the primary-mode agent is also the default_agent.
    // The route checks both `default_agent === name` and `agent.mode === 'primary'`.
    const configWithPrimary = {
      default_agent: 'main',
      agent: {
        main: {
          display_name: 'Main',
          mode: 'primary',
        },
        helper: {
          display_name: 'Helper',
          mode: 'subagent',
        },
      },
    }
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify(configWithPrimary),
      hash: 'hash-x',
    })

    const response = await DELETE(
      makeDeleteRequest('main'),
      routeParams('main'),
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('primary_agent')
  })

  it('prevents deleting last agent', async () => {
    const singleAgentConfig = {
      default_agent: 'solo',
      agent: {
        solo: {
          display_name: 'Solo',
          mode: 'subagent',
        },
      },
    }
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify(singleAgentConfig),
      hash: 'hash-solo',
    })

    const response = await DELETE(
      makeDeleteRequest('solo'),
      routeParams('solo'),
    )
    // Solo is the default_agent, so it will be caught by the primary check first
    expect(response.status).toBe(409)
  })

  it('prevents deleting when it would leave zero agents', async () => {
    // Config with 2 agents, one primary, one not. Deleting the non-primary
    // leaves 1 agent which is fine. But if we had only 1 non-primary agent
    // and tried to delete it, we get last_agent. We need a config where
    // the agent is neither default nor primary-mode, but is the only one.
    // That is actually invalid per validation, so let's test with a config
    // that has one non-default, non-primary agent alongside the primary.
    // The "last_agent" error only triggers when Object.keys(remaining) === 0
    // which means only 1 agent total. But that agent would always be the default.
    // So this path is effectively guarded by the primary_agent check first.
    // Let's verify that scenario:
    const singleConfig = {
      default_agent: 'only',
      agent: {
        only: {
          display_name: 'Only',
          mode: 'subagent', // not primary, but it is default_agent
        },
      },
    }
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify(singleConfig),
      hash: 'hash-only',
    })

    const response = await DELETE(
      makeDeleteRequest('only'),
      routeParams('only'),
    )
    // Caught by default_agent check
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe('primary_agent')
  })

  it('returns 404 for missing agent', async () => {
    const response = await DELETE(
      makeDeleteRequest('nonexistent'),
      routeParams('nonexistent'),
    )
    expect(response.status).toBe(404)

    const body = await response.json()
    expect(body.error).toBe('not_found')
  })

  it('returns 404 when config not_found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'not_found',
    })

    const response = await DELETE(
      makeDeleteRequest('assistant'),
      routeParams('assistant'),
    )
    expect(response.status).toBe(404)
  })

  it('returns 503 when kb_unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const response = await DELETE(
      makeDeleteRequest('assistant'),
      routeParams('assistant'),
    )
    expect(response.status).toBe(503)
  })

  it('returns 409 when write results in conflict', async () => {
    mockWriteCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'conflict',
    })

    const response = await DELETE(
      makeDeleteRequest('researcher'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('conflict')
  })

  it('passes expectedHash from body', async () => {
    const response = await DELETE(
      makeDeleteRequest('researcher', { expectedHash: 'custom-hash' }),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    // Verify the write was called with the custom hash
    const writeCall = mockWriteCommonWorkspaceConfig.mock.calls[0]
    expect(writeCall[1]).toBe('custom-hash')
  })

  it('uses config hash when body has no expectedHash', async () => {
    const response = await DELETE(
      makeDeleteRequest('researcher'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(200)

    const writeCall = mockWriteCommonWorkspaceConfig.mock.calls[0]
    expect(writeCall[1]).toBe('hash-1')
  })

  it('returns 401 when session is null', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE(
      makeDeleteRequest('researcher'),
      routeParams('researcher'),
    )
    expect(response.status).toBe(401)
  })
})
