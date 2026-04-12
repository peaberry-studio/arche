import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockValidateDesktopToken = vi.fn()
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (...args: unknown[]) => mockValidateDesktopToken(...args),
}))

const mockRunWithDesktopVaultContext = vi.fn()
vi.mock('@/lib/runtime/desktop/context', () => ({
  runWithDesktopVaultContext: (...args: unknown[]) => mockRunWithDesktopVaultContext(...args),
}))

const mockGetDesktopVaultRuntimeContext = vi.fn()
vi.mock('@/lib/runtime/desktop/context-store', () => ({
  getDesktopVaultRuntimeContext: (...args: unknown[]) => mockGetDesktopVaultRuntimeContext(...args),
}))

const mockGetDesktopSession = vi.fn()
vi.mock('@/lib/runtime/session-desktop', () => ({
  getDesktopSession: (...args: unknown[]) => mockGetDesktopSession(...args),
}))

const mockApplyKickstart = vi.fn()
vi.mock('@/kickstart/apply', () => ({
  applyKickstart: (...args: unknown[]) => mockApplyKickstart(...args),
}))

describe('desktop kickstart prepare vault route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockValidateDesktopToken.mockReturnValue(true)
    mockRunWithDesktopVaultContext.mockImplementation(async (_vaultPath, callback) => callback())
    mockGetDesktopVaultRuntimeContext.mockReturnValue({
      prismaClient: {
        $disconnect: vi.fn().mockResolvedValue(undefined),
      },
    })
    mockGetDesktopSession.mockResolvedValue({
      user: { id: 'local', email: 'local@arche.local', slug: 'local', role: 'ADMIN' },
      sessionId: 'local',
    })
    mockApplyKickstart.mockResolvedValue({ ok: true })
  })

  it('returns 401 when the desktop token is invalid', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const { POST } = await import('@/app/api/internal/desktop/kickstart/prepare-vault/route')
    const response = await POST(new Request('http://localhost/api/internal/desktop/kickstart/prepare-vault', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vaultPath: '/tmp/vault', kickstartPayload: {} }),
    }) as never)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('returns 400 when vaultPath is missing', async () => {
    const { POST } = await import('@/app/api/internal/desktop/kickstart/prepare-vault/route')
    const response = await POST(new Request('http://localhost/api/internal/desktop/kickstart/prepare-vault', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-arche-desktop-token': 'desktop-token',
      },
      body: JSON.stringify({ kickstartPayload: {} }),
    }) as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_payload',
      message: 'vaultPath is required',
    })
  })

  it('applies kickstart inside the requested vault context', async () => {
    const payload = { companyName: 'Acme', companyDescription: 'Desc', templateId: 'blank', agents: [{ id: 'assistant' }] }

    const { POST } = await import('@/app/api/internal/desktop/kickstart/prepare-vault/route')
    const response = await POST(new Request('http://localhost/api/internal/desktop/kickstart/prepare-vault', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-arche-desktop-token': 'desktop-token',
      },
      body: JSON.stringify({ vaultPath: '/tmp/vault', kickstartPayload: payload }),
    }) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockRunWithDesktopVaultContext).toHaveBeenCalledTimes(1)
    expect(mockRunWithDesktopVaultContext.mock.calls[0]?.[0]).toBe('/tmp/vault')
    expect(mockApplyKickstart).toHaveBeenCalledWith(payload, 'local')
  })
})
