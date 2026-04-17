import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetWebSession = vi.fn()
const mockGetDesktopSession = vi.fn()

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

    vi.doMock('@/lib/runtime/session-web', () => ({
      getWebSession: (...args: unknown[]) => mockGetWebSession(...args),
    }))

    vi.doMock('@/lib/runtime/session-desktop', () => ({
      getDesktopSession: (...args: unknown[]) => mockGetDesktopSession(...args),
    }))
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
    mockGetWebSession.mockResolvedValue(webSession)

    const { getSession } = await import('../session')
    const result = await getSession()

    expect(result).toEqual(webSession)
    expect(mockGetWebSession).toHaveBeenCalledOnce()
  })

  it('returns null when web session is not authenticated', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    mockGetWebSession.mockResolvedValue(null)

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
    expect(mockGetWebSession).not.toHaveBeenCalled()
  })

  it('does not import the web session module in desktop mode', async () => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_PLATFORM: 'darwin',
      ARCHE_DESKTOP_WEB_HOST: '127.0.0.1',
    }

    vi.doMock('@/lib/runtime/session-web', () => {
      throw new Error('session-web should not load in desktop mode')
    })

    vi.doMock('@/lib/runtime/session-desktop', () => ({
      getDesktopSession: (...args: unknown[]) => mockGetDesktopSession(...args),
    }))

    const { getSession } = await import('../session')
    const result = await getSession()

    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('local')
  })
})
