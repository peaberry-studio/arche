import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, connectors: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  requireCapability: vi.fn(() => null),
  auditEvent: vi.fn(),
  decryptConfig: vi.fn(),
  encryptConfig: vi.fn(),
  requireConnectorCapability: vi.fn(() => null),
  validateConnectorConfig: vi.fn(() => ({ valid: true })),
  validateConnectorType: vi.fn(() => true),
  loadConnectorToolInventory: vi.fn(),
  connectorService: {
    findByIdAndUserId: vi.fn(),
    updateManyByIdAndUserId: vi.fn(),
  },
  userService: { findIdBySlug: vi.fn() },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: mocks.decryptConfig,
  encryptConfig: mocks.encryptConfig,
}))
vi.mock('@/lib/connectors/require-connector-capability', () => ({
  requireConnectorCapability: mocks.requireConnectorCapability,
}))
vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorConfig: mocks.validateConnectorConfig,
  validateConnectorType: mocks.validateConnectorType,
}))
vi.mock('@/lib/connectors/tool-inventory', () => ({
  loadConnectorToolInventory: mocks.loadConnectorToolInventory,
}))
vi.mock('@/lib/services', () => ({
  connectorService: mocks.connectorService,
  userService: mocks.userService,
}))

import { GET, PATCH } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const CONNECTOR = { id: 'c1', type: 'linear', config: 'encrypted', enabled: true }

function makeGetRequest() {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/tool-permissions', { method: 'GET' })
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/tool-permissions', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function makeInvalidJsonPatchRequest() {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/tool-permissions', {
    method: 'PATCH',
    body: '{',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function params() {
  return { params: Promise.resolve({ slug: 'admin', id: 'c1' }) }
}

describe('/api/u/[slug]/connectors/[id]/tool-permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(CONNECTOR)
    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValue({ count: 1 })
    mocks.decryptConfig.mockReturnValue({
      apiKey: 'key',
      mcpToolPermissions: { list_issues: 'ask' },
    })
    mocks.encryptConfig.mockReturnValue('next-encrypted')
    mocks.validateConnectorType.mockReturnValue(true)
    mocks.validateConnectorConfig.mockReturnValue({ valid: true })
    mocks.requireConnectorCapability.mockReturnValue(null)
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.loadConnectorToolInventory.mockResolvedValue({
      ok: true,
      tools: [
        { name: 'list_issues', title: 'List issues', description: 'List Linear issues' },
        { name: 'create_issue', title: 'Create issue' },
      ],
    })
  })

  it('returns tool permissions with allow defaults for missing stored values', async () => {
    const res = await GET(makeGetRequest(), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      policyConfigured: true,
      tools: [
        {
          name: 'list_issues',
          title: 'List issues',
          description: 'List Linear issues',
          permission: 'ask',
        },
        {
          name: 'create_issue',
          title: 'Create issue',
          description: undefined,
          permission: 'allow',
        },
      ],
    })
  })

  it('updates, encrypts and audits connector tool permissions', async () => {
    const res = await PATCH(makePatchRequest({ permissions: { create_issue: 'deny' } }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.tools).toEqual([
      expect.objectContaining({ name: 'list_issues', permission: 'ask' }),
      expect.objectContaining({ name: 'create_issue', permission: 'deny' }),
    ])
    expect(mocks.encryptConfig).toHaveBeenCalledWith({
      apiKey: 'key',
      mcpToolPermissions: {
        list_issues: 'ask',
        create_issue: 'deny',
      },
    })
    expect(mocks.connectorService.updateManyByIdAndUserId).toHaveBeenCalledWith('c1', 'u1', {
      config: 'next-encrypted',
    })
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector.tool_permissions_updated' }),
    )
  })

  it('rejects unknown tool permission keys', async () => {
    const res = await PATCH(makePatchRequest({ permissions: { unknown_tool: 'ask' } }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_permissions')
  })

  it('returns conflict when no tools can be loaded or recovered from stored config', async () => {
    mocks.decryptConfig.mockReturnValue({ apiKey: 'key' })
    mocks.loadConnectorToolInventory.mockResolvedValue({
      ok: false,
      tools: [],
      message: 'Remote MCP tools could not be loaded.',
    })

    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('tools_unavailable')
  })

  it('falls back to stored permissions when inventory cannot be loaded', async () => {
    mocks.loadConnectorToolInventory.mockResolvedValue({
      ok: false,
      tools: [],
      message: 'Remote MCP tools could not be loaded.',
    })

    const res = await GET(makeGetRequest(), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      inventoryError: 'Remote MCP tools could not be loaded.',
      policyConfigured: true,
      tools: [
        {
          name: 'list_issues',
          title: 'list_issues',
          description: undefined,
          permission: 'ask',
        },
      ],
    })
  })

  it('returns connector lookup and config errors', async () => {
    mocks.userService.findIdBySlug.mockResolvedValueOnce(null)
    let res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'user_not_found' })

    mocks.connectorService.findByIdAndUserId.mockResolvedValueOnce(null)
    res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'connector_not_found' })

    mocks.validateConnectorType.mockReturnValueOnce(false)
    res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'unsupported_connector' })

    mocks.decryptConfig.mockImplementationOnce(() => {
      throw new Error('corrupt')
    })
    res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: 'config_corrupted',
      message: 'Failed to decrypt connector configuration',
    })

    mocks.validateConnectorConfig.mockReturnValueOnce({ valid: false, message: 'Config is invalid.' })
    res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: 'invalid_config',
      message: 'Config is invalid.',
    })
  })

  it('returns capability denials before loading connector settings', async () => {
    mocks.requireCapability.mockReturnValueOnce(NextResponse.json({ error: 'runtime_disabled' }, { status: 503 }))

    let res = await GET(makeGetRequest(), params())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'runtime_disabled' })
    expect(mocks.userService.findIdBySlug).not.toHaveBeenCalled()

    mocks.requireConnectorCapability.mockReturnValueOnce(
      NextResponse.json({ error: 'connector_disabled' }, { status: 503 }),
    )
    res = await GET(makeGetRequest(), params())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'connector_disabled' })
  })

  it('rejects invalid PATCH bodies', async () => {
    let res = await PATCH(makeInvalidJsonPatchRequest(), params())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_json' })

    res = await PATCH(makePatchRequest(null), params())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'invalid_body',
      message: 'Request body must be a JSON object',
    })
  })

  it('returns encryption and update failures when saving permissions', async () => {
    mocks.encryptConfig.mockImplementationOnce(() => {
      throw new Error('cannot encrypt')
    })

    let res = await PATCH(makePatchRequest({ permissions: { create_issue: 'deny' } }), params())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'invalid_config',
      message: 'cannot encrypt',
    })

    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValueOnce({ count: 0 })
    res = await PATCH(makePatchRequest({ permissions: { create_issue: 'deny' } }), params())
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'connector_not_found' })
  })
})
