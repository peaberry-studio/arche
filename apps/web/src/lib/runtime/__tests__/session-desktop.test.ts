import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitDesktopPrisma = vi.fn()
const mockUpsert = vi.fn()

vi.mock('@/lib/prisma-desktop-init', () => ({
  initDesktopPrisma: (...args: unknown[]) => mockInitDesktopPrisma(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}))

describe('getDesktopSession', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockInitDesktopPrisma.mockResolvedValue(undefined)
    mockUpsert.mockResolvedValue({
      id: 'local',
      email: 'local@arche.local',
      slug: 'local',
      role: 'ADMIN',
    })
  })

  it('initializes desktop prisma before loading the local user session', async () => {
    const { getDesktopSession } = await import('../session-desktop')

    await getDesktopSession()

    expect(mockInitDesktopPrisma).toHaveBeenCalledOnce()
    expect(mockUpsert).toHaveBeenCalledOnce()
    expect(mockInitDesktopPrisma.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpsert.mock.invocationCallOrder[0],
    )
  })

  it('caches the session and does not call upsert on subsequent calls', async () => {
    const { getDesktopSession } = await import('../session-desktop')

    const result1 = await getDesktopSession()
    const result2 = await getDesktopSession()

    expect(mockUpsert).toHaveBeenCalledOnce()
    expect(result1).toEqual(result2)
    expect(result1).toEqual({
      user: {
        id: 'local',
        email: 'local@arche.local',
        slug: 'local',
        role: 'ADMIN',
      },
      sessionId: 'local',
    })
  })
})
