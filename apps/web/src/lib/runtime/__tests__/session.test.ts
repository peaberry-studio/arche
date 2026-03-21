import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockGetDesktopSession = vi.fn()

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

vi.mock('@/lib/runtime/session-desktop', () => ({
  getDesktopSession: (...args: unknown[]) => mockGetDesktopSession(...args),
}))

describe('runtime session dispatcher', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    mockGetDesktopSession.mockResolvedValue({
      user: { id: 'local', email: 'local@arche.local', slug: 'local', role: 'ADMIN' },
      sessionId: 'local',
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('delegates to web session (getAuthenticatedUser) in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE

    const webSession = {
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    }
    mockGetAuthenticatedUser.mockResolvedValue(webSession)

    const { getSession } = await import('../session')
    const result = await getSession()

    expect(result).toEqual(webSession)
    expect(mockGetAuthenticatedUser).toHaveBeenCalledOnce()
  })

  it('returns null when web session is not authenticated', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    mockGetAuthenticatedUser.mockResolvedValue(null)

    const { getSession } = await import('../session')
    const result = await getSession()

    expect(result).toBeNull()
  })

  it('returns synthetic local user in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const { getSession } = await import('../session')
    const result = await getSession()

    expect(result).not.toBeNull()
    expect(result!.user.slug).toBe('local')
    expect(result!.user.role).toBe('ADMIN')
    expect(result!.sessionId).toBe('local')
    expect(mockGetAuthenticatedUser).not.toHaveBeenCalled()
  })
})
