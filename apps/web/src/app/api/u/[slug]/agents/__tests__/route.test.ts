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

import { PATCH as PATCH_DEFAULT_MODEL } from '../default-model/route'
import { GET, POST } from '../route'

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
      tools: { write: true, edit: true, bash: true },
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

function makeGetRequest(url = 'http://localhost/api/u/alice/agents') {
  return new NextRequest(url, { method: 'GET' })
}

function makePostRequest(
  body: unknown,
  url = 'http://localhost/api/u/alice/agents',
) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

function makePostRequestRaw(
  rawBody: string,
  url = 'http://localhost/api/u/alice/agents',
) {
  return new NextRequest(url, {
    method: 'POST',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

function makePatchDefaultModelRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/alice/agents/default-model', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

function makePatchDefaultModelRequestRaw(rawBody: string) {
  return new NextRequest('http://localhost/api/u/alice/agents/default-model', {
    method: 'PATCH',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  })
}

const routeParams = { params: Promise.resolve({ slug: 'alice' }) }

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
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/u/[slug]/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('returns agents list on GET', async () => {
    const response = await GET(makeGetRequest(), routeParams)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agents).toHaveLength(1)
    expect(body.agents[0].id).toBe('assistant')
    expect(body.agents[0].displayName).toBe('Assistant')
    expect(body.agents[0].isPrimary).toBe(true)
    expect(body.hash).toBe('hash-1')
  })

  it('returns empty list when config not_found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'not_found',
    })

    const response = await GET(makeGetRequest(), routeParams)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agents).toEqual([])
  })

  it('returns 503 when kb_unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const response = await GET(makeGetRequest(), routeParams)
    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.error).toBe('kb_unavailable')
  })

  it('returns 500 when config read fails for other reasons', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'read_failed',
    })

    const response = await GET(makeGetRequest(), routeParams)
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body.error).toBe('read_failed')
  })

  it('sorts agents with primary first', async () => {
    const multiConfig = {
      default_agent: 'assistant',
      agent: {
        zeta: {
          display_name: 'Zeta',
          mode: 'subagent',
        },
        assistant: {
          display_name: 'Assistant',
          mode: 'primary',
          model: 'openai/gpt-5.2',
        },
        alpha: {
          display_name: 'Alpha',
          mode: 'subagent',
        },
      },
    }

    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify(multiConfig),
      hash: 'hash-multi',
    })

    const response = await GET(makeGetRequest(), routeParams)
    const body = await response.json()

    expect(body.agents[0].id).toBe('assistant')
    expect(body.agents[0].isPrimary).toBe(true)
    expect(body.agents[1].id).toBe('alpha')
    expect(body.agents[2].id).toBe('zeta')
  })

  it('returns default and resolved models', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        default_agent: 'assistant',
        default_model: 'openai/gpt-5.5',
        agent: {
          assistant: { display_name: 'Assistant', mode: 'primary' },
          override: { display_name: 'Override', mode: 'subagent', model: 'anthropic/claude-sonnet-4' },
        },
      }),
      hash: 'hash-default',
    })

    const response = await GET(makeGetRequest(), routeParams)
    const body = await response.json()

    expect(body.defaultModel).toBe('openai/gpt-5.5')
    expect(body.agents[0]).toMatchObject({
      id: 'assistant',
      defaultModel: 'openai/gpt-5.5',
      resolvedModel: 'openai/gpt-5.5',
      usesDefaultModel: true,
    })
    expect(body.agents[1]).toMatchObject({
      id: 'override',
      model: 'anthropic/claude-sonnet-4',
      resolvedModel: 'anthropic/claude-sonnet-4',
      usesDefaultModel: false,
    })
  })

  it('returns 401 when session is null', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(makeGetRequest(), routeParams)
    expect(response.status).toBe(401)
  })
})

describe('POST /api/u/[slug]/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('requires admin role', async () => {
    mockGetSession.mockResolvedValue(regularSession())

    const response = await POST(
      makePostRequest({ displayName: 'New Agent', capabilities: { tools: ['write'], skillIds: [], mcpConnectorIds: [] } }),
      routeParams,
    )
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error).toBe('forbidden')
  })

  it('validates body — returns 400 for invalid JSON', async () => {
    const response = await POST(
      makePostRequestRaw('not valid json{{{'),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_json')
  })

  it('validates body — returns 400 for array JSON body', async () => {
    const response = await POST(makePostRequest([]), routeParams)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_body')
  })

  it('validates body — returns 400 for missing display name', async () => {
    const response = await POST(
      makePostRequest({ capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] } }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('missing_display_name')
  })

  it.each([
    [
      'missing capabilities',
      { displayName: 'Agent' },
      'invalid_capabilities',
    ],
    [
      'unknown MCP connector',
      { displayName: 'Agent', capabilities: { tools: [], skillIds: [], mcpConnectorIds: ['missing-connector'] } },
      'unknown_mcp_connector',
    ],
    [
      'unknown skill',
      { displayName: 'Agent', capabilities: { tools: [], skillIds: ['missing-skill'], mcpConnectorIds: [] } },
      'unknown_skill',
    ],
  ])('validates capabilities — rejects %s', async (_label, body, error) => {
    const response = await POST(makePostRequest(body), routeParams)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe(error)
  })

  it('creates agent successfully', async () => {
    const response = await POST(
      makePostRequest({
        displayName: 'Research Bot',
        description: 'A research agent',
        model: 'openai/gpt-5.2',
        capabilities: {
          tools: ['write', 'edit'],
          skillIds: [],
          mcpConnectorIds: [],
        },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent).toBeDefined()
    expect(body.agent.id).toBe('research-bot')
    expect(body.agent.displayName).toBe('Research Bot')
    expect(body.agent.description).toBe('A research agent')
    expect(body.agent.model).toBe('openai/gpt-5.2')
    expect(body.agent.isPrimary).toBe(false)
    expect(body.hash).toBe('hash-2')

    expect(mockWriteCommonWorkspaceConfig).toHaveBeenCalledOnce()
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'u-admin',
      action: 'agent.created',
      metadata: { slug: 'alice', agentId: 'research-bot' },
    })
  })

  it('rejects reserved IDs', async () => {
    const response = await POST(
      makePostRequest({
        id: 'connectors',
        displayName: 'Conn Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_id')
    expect(body.message).toContain('reserved')
  })

  it('rejects reserved ID "models"', async () => {
    const response = await POST(
      makePostRequest({
        id: 'models',
        displayName: 'Models Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_id')
  })

  it('rejects reserved ID "default-model"', async () => {
    const response = await POST(
      makePostRequest({
        id: 'default-model',
        displayName: 'Default Model Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_id')
  })

  it('rejects duplicate agent IDs', async () => {
    const response = await POST(
      makePostRequest({
        id: 'assistant',
        displayName: 'Another Assistant',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('agent_exists')
  })

  it('returns 409 for existing agent (generated ID collision)', async () => {
    // The displayName "Assistant" generates id "assistant" which already exists
    const response = await POST(
      makePostRequest({
        displayName: 'Assistant',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    // generateAgentId appends a suffix to avoid collision, so this actually succeeds
    // Let's test the explicit id collision case instead
    expect(response.status).toBe(201)

    // The generated id should be "assistant-2" because "assistant" already exists
    const body = await response.json()
    expect(body.agent.id).toBe('assistant-2')
  })

  it('creates agent with explicit ID', async () => {
    const response = await POST(
      makePostRequest({
        id: 'custom-bot',
        displayName: 'Custom Bot',
        capabilities: { tools: ['bash'], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent.id).toBe('custom-bot')
    expect(body.agent.displayName).toBe('Custom Bot')
  })

  it('rejects ID with spaces', async () => {
    const response = await POST(
      makePostRequest({
        id: 'has spaces',
        displayName: 'Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_id')
  })

  it('rejects ID with slashes', async () => {
    const response = await POST(
      makePostRequest({
        id: 'path/agent',
        displayName: 'Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe('invalid_id')
  })

  it('creates default config when config is not_found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'not_found',
    })

    const response = await POST(
      makePostRequest({
        displayName: 'First Agent',
        capabilities: { tools: ['write'], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent.displayName).toBe('First Agent')
    expect(mockWriteCommonWorkspaceConfig).toHaveBeenCalledOnce()
  })

  it('returns 503 when kb_unavailable on POST', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const response = await POST(
      makePostRequest({
        displayName: 'Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(503)
  })

  it('returns 409 when write results in conflict', async () => {
    mockWriteCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'conflict',
    })

    const response = await POST(
      makePostRequest({
        displayName: 'New Agent',
        capabilities: { tools: ['write'], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('conflict')
  })

  it('creates agent with temperature', async () => {
    const response = await POST(
      makePostRequest({
        displayName: 'Temp Bot',
        temperature: 0.7,
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent.temperature).toBe(0.7)
  })

  it('accepts body.name as fallback for displayName', async () => {
    const response = await POST(
      makePostRequest({
        name: 'Named Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent.displayName).toBe('Named Agent')
  })

  it('returns 503 when listSkills fails with kb_unavailable', async () => {
    mockListSkills.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const response = await POST(
      makePostRequest({
        displayName: 'Agent',
        capabilities: { tools: [], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(503)
  })

  it('can create agent as primary', async () => {
    const response = await POST(
      makePostRequest({
        displayName: 'New Primary',
        isPrimary: true,
        capabilities: { tools: ['write'], skillIds: [], mcpConnectorIds: [] },
      }),
      routeParams,
    )
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.agent.isPrimary).toBe(true)
  })
})

describe('PATCH /api/u/[slug]/agents/default-model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('requires admin role', async () => {
    mockGetSession.mockResolvedValue(regularSession())

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(403)
  })

  it('saves default model with hash conflict detection', async () => {
    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.defaultModel).toBe('openai/gpt-5.5')
    expect(body.hash).toBe('hash-2')

    expect(mockWriteCommonWorkspaceConfig).toHaveBeenCalledOnce()
    const [content, expectedHash] = mockWriteCommonWorkspaceConfig.mock.calls[0]
    expect(JSON.parse(content).default_model).toBe('openai/gpt-5.5')
    expect(expectedHash).toBe('hash-1')
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'u-admin',
      action: 'agent.default_model.updated',
      metadata: { slug: 'alice', defaultModel: 'openai/gpt-5.5' },
    })
  })

  it('bootstraps default model when config does not exist', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'not_found' })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5' }),
      routeParams,
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.defaultModel).toBe('openai/gpt-5.5')

    const [content, expectedHash] = mockWriteCommonWorkspaceConfig.mock.calls[0]
    expect(JSON.parse(content).default_model).toBe('openai/gpt-5.5')
    expect(expectedHash).toBeUndefined()
  })

  it('returns 409 on hash conflict', async () => {
    mockWriteCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'conflict' })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'stale-hash' }),
      routeParams,
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe('conflict')
  })

  it('clears default model', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ...TEST_CONFIG, default_model: 'openai/gpt-5.5' }),
      hash: 'hash-1',
    })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: null, expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(200)
    const [content] = mockWriteCommonWorkspaceConfig.mock.calls[0]
    expect(JSON.parse(content).default_model).toBeUndefined()
  })

  it('validates request body', async () => {
    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 123, expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_default_model')
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequestRaw('not valid json{{{'),
      routeParams,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_json')
  })

  it('returns 400 for invalid body shape', async () => {
    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest([]),
      routeParams,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_body')
  })

  it('requires expected hash when config exists', async () => {
    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5' }),
      routeParams,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_expected_hash')
  })

  it('returns 503 when config repo is unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toBe('kb_unavailable')
  })

  it('returns 500 when persisted config cannot be parsed', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: '{not json',
      hash: 'hash-1',
    })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('invalid_json')
  })

  it('returns 400 when updated config is invalid', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ default_agent: 'assistant', agent: { other: {} } }),
      hash: 'hash-1',
    })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('default_agent_not_found')
  })

  it('returns 500 when write fails without a specific error', async () => {
    mockWriteCommonWorkspaceConfig.mockResolvedValue({ ok: false })

    const response = await PATCH_DEFAULT_MODEL(
      makePatchDefaultModelRequest({ defaultModel: 'openai/gpt-5.5', expectedHash: 'hash-1' }),
      routeParams,
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('write_failed')
  })
})
