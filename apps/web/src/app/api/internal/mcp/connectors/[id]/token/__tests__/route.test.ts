import { createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ credentials: vi.fn(), user: vi.fn(), connector: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.audit }))
vi.mock('@/lib/services', () => ({
  instanceService: { findCredentialsBySlug: mocks.credentials },
  userService: { findIdBySlug: mocks.user },
  connectorService: { findEnabledByIdAndUserId: mocks.connector },
}))
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: (value: string) => value }))

import { POST } from '@/app/api/internal/mcp/connectors/[id]/token/route'
import { verifyConnectorGatewayToken } from '@/lib/connectors/gateway-tokens'
import { getConnectorProxyTarget } from '@/lib/connectors/workspace-proxy'
import { isWorkspaceCredentialCurrent } from '@/lib/security/workspace-auth'

function renew(id = 'owned', password = 'fixture', slug = 'alice') {
  return POST(new Request(`http://localhost/api/internal/mcp/connectors/${id}/token?workspace=${slug}`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
  }), { params: Promise.resolve({ id }) })
}

describe('workspace connector credential renewal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubEnv('ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET', 'fixture')
    mocks.credentials.mockResolvedValue({ serverPassword: 'fixture', status: 'running' })
    mocks.user.mockResolvedValue({ id: 'alice-id' })
    mocks.connector.mockImplementation(async (id, userId) => id === 'owned' && userId === 'alice-id' ? { id, userId } : null)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  it('issues a scoped five-minute credential and renews without a runtime restart', async () => {
    const response = await renew()
    expect(response.headers.get('cache-control')).toBe('no-store')
    const first = await response.json()
    const payload = verifyConnectorGatewayToken(first.token)
    expect(payload).toMatchObject({ userId: 'alice-id', workspaceSlug: 'alice', connectorId: 'owned', aud: 'connector-gateway' })
    expect(payload.exp - payload.iat).toBe(300)
    expect(await isWorkspaceCredentialCurrent('alice', payload.credentialEpoch)).toBe(true)
    vi.advanceTimersByTime(300_000)
    expect(() => verifyConnectorGatewayToken(first.token)).toThrow('invalid_token')
    const second = await (await renew()).json()
    expect(verifyConnectorGatewayToken(second.token).exp).toBe(payload.exp + 300)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector.gateway_token_issued', actorUserId: 'alice-id' }))
  })

  it.each(['stopped', 'stopping', 'error'])('revokes access and renewal for a %s workspace', async (status) => {
    const { token } = await (await renew()).json()
    const payload = verifyConnectorGatewayToken(token)
    mocks.credentials.mockResolvedValue({ serverPassword: 'fixture', status })
    expect(await isWorkspaceCredentialCurrent('alice', payload.credentialEpoch)).toBe(false)
    expect((await renew()).status).toBe(401)
  })

  it('revokes old credentials after restart, including the local connector capability', async () => {
    const { token } = await (await renew()).json()
    const payload = verifyConnectorGatewayToken(token)
    const oldTarget = await getConnectorProxyTarget('alice', 'owned', 4097)
    mocks.credentials.mockResolvedValue({ serverPassword: 'rotated', status: 'running' })
    expect(await isWorkspaceCredentialCurrent('alice', payload.credentialEpoch)).toBe(false)
    expect((await renew()).status).toBe(401)
    expect((await renew('owned', 'rotated')).status).toBe(200)
    expect((await getConnectorProxyTarget('alice', 'owned', 4999)).token).not.toBe(oldTarget.token)
  })

  it('rejects other owners, disabled connectors and wrong workspace passwords', async () => {
    expect((await renew('victim-connector')).status).toBe(401)
    expect((await renew('owned', 'wrong')).status).toBe(401)
    mocks.connector.mockResolvedValue(null)
    expect((await renew()).status).toBe(401)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects the previously supported permanent token format', () => {
    const encoded = Buffer.from(JSON.stringify({ userId: 'alice-id', workspaceSlug: 'alice', connectorId: 'owned' })).toString('base64url')
    const signature = createHmac('sha256', 'fixture').update(encoded).digest('base64url')
    expect(() => verifyConnectorGatewayToken(`${encoded}.${signature}`)).toThrow('invalid_token')
  })

  it('makes local proxy capabilities connector-specific without exposing the workspace password', async () => {
    const target = await getConnectorProxyTarget('alice', 'owned', 4999)
    expect(target.url).toBe('http://127.0.0.1:4999/mcp/connectors/owned')
    expect(target.token).toBe(createHmac('sha256', 'fixture').update('arche-connector-proxy:owned').digest('base64url'))
    expect(target.token).not.toContain('fixture')
    expect((await getConnectorProxyTarget('alice', 'other', 4999)).token).not.toBe(target.token)
  })
})
