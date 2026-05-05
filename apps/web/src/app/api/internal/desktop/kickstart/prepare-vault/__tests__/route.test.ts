import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateDesktopToken: vi.fn(),
  runWithDesktopVaultContext: vi.fn(),
  getDesktopSession: vi.fn(),
  applyKickstart: vi.fn(),
  getDesktopVaultRuntimeContext: vi.fn(),
}))

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (token: string | null) => mocks.validateDesktopToken(token),
}))

vi.mock('@/lib/runtime/desktop/context', () => ({
  runWithDesktopVaultContext: (vaultPath: string, callback: () => Promise<unknown>) =>
    mocks.runWithDesktopVaultContext(vaultPath, callback),
}))

vi.mock('@/lib/runtime/session-desktop', () => ({
  getDesktopSession: () => mocks.getDesktopSession(),
}))

vi.mock('@/kickstart/apply', () => ({
  applyKickstart: (...args: unknown[]) => mocks.applyKickstart(...args),
}))

vi.mock('@/lib/runtime/desktop/context-store', () => ({
  getDesktopVaultRuntimeContext: () => mocks.getDesktopVaultRuntimeContext(),
}))

import { POST } from '../route'

function makeRequest(body: unknown, headers?: HeadersInit): NextRequest {
  return new NextRequest('http://localhost/api/internal/desktop/kickstart/prepare-vault', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/desktop/kickstart/prepare-vault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.getDesktopSession.mockResolvedValue({ user: { id: 'local' } })
    mocks.applyKickstart.mockResolvedValue({ ok: true })
    mocks.getDesktopVaultRuntimeContext.mockReturnValue({
      databaseUrl: 'file:/vault/db.sqlite',
      vaultRoot: '/vault',
      prismaClient: { $disconnect: vi.fn().mockResolvedValue(undefined) },
    })
    mocks.runWithDesktopVaultContext.mockImplementation(
      async (_vaultPath: string, callback: () => Promise<unknown>) => {
        return callback()
      },
    )
  })

  it('returns 401 when desktop token is invalid', async () => {
    mocks.validateDesktopToken.mockReturnValue(false)
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 400 when vaultPath is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_payload')
    expect(body.message).toContain('vaultPath')
  })

  it('returns 400 when vaultPath is empty string', async () => {
    const res = await POST(makeRequest({ vaultPath: '   ' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_payload')
  })

  it('applies kickstart successfully', async () => {
    const res = await POST(makeRequest({ vaultPath: '/vault', kickstartPayload: { template: 'test' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.runWithDesktopVaultContext).toHaveBeenCalledWith('/vault', expect.any(Function))
    expect(mocks.applyKickstart).toHaveBeenCalledWith({ template: 'test' }, 'local')
  })

  it('returns error status from applyKickstart (conflict)', async () => {
    mocks.applyKickstart.mockResolvedValue({ ok: false, error: 'conflict', message: 'Already configured' })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', message: 'Already configured' })
  })

  it('returns 400 for invalid_payload error', async () => {
    mocks.applyKickstart.mockResolvedValue({ ok: false, error: 'invalid_payload', message: 'Bad payload' })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_payload', message: 'Bad payload' })
  })

  it('returns 409 for already_configured error', async () => {
    mocks.applyKickstart.mockResolvedValue({
      ok: false,
      error: 'already_configured',
      message: 'Already configured',
    })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(409)
  })

  it('returns 503 for kb_unavailable error', async () => {
    mocks.applyKickstart.mockResolvedValue({ ok: false, error: 'kb_unavailable', message: 'KB unavailable' })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'kb_unavailable', message: 'KB unavailable' })
  })

  it('returns 500 for unknown errors', async () => {
    mocks.applyKickstart.mockResolvedValue({ ok: false, error: 'apply_failed', message: 'Failed' })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'apply_failed', message: 'Failed' })
  })

  it('disconnects prisma and cleans up context in finally', async () => {
    const disconnectMock = vi.fn().mockResolvedValue(undefined)
    mocks.getDesktopVaultRuntimeContext.mockReturnValue({
      databaseUrl: 'file:/vault/db.sqlite',
      vaultRoot: '/vault',
      prismaClient: { $disconnect: disconnectMock },
      initPromise: Promise.resolve(),
      prismaClientPromise: Promise.resolve(),
      session: { user: { id: 'local' } },
    })
    const res = await POST(makeRequest({ vaultPath: '/vault' }))
    expect(res.status).toBe(200)
    expect(disconnectMock).toHaveBeenCalled()
  })
})
