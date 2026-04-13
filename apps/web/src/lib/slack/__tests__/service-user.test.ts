import { beforeEach, describe, expect, it, vi } from 'vitest'

const hashMock = vi.fn()
const generatePasswordMock = vi.fn()
const createMock = vi.fn()
const findExistingByEmailOrSlugMock = vi.fn()

vi.mock('argon2', () => ({
  default: {
    hash: (...args: unknown[]) => hashMock(...args),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  generatePassword: (...args: unknown[]) => generatePasswordMock(...args),
}))

vi.mock('@/lib/services', () => ({
  userService: {
    create: (...args: unknown[]) => createMock(...args),
    findExistingByEmailOrSlug: (...args: unknown[]) => findExistingByEmailOrSlugMock(...args),
  },
}))

describe('ensureSlackServiceUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generatePasswordMock.mockReturnValue('generated-password')
    hashMock.mockResolvedValue('hashed-password')
  })

  it('returns the existing service user when it is already provisioned', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue({
      email: 'slack-bot@arche.local',
      id: 'service-1',
      kind: 'SERVICE',
      role: 'USER',
      slug: 'slack-bot',
    })

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('returns a conflict when the reserved identity belongs to a human user', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue({
      email: 'slack-bot@arche.local',
      id: 'human-1',
      kind: 'HUMAN',
      role: 'USER',
      slug: 'slack-bot',
    })

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: false, error: 'service_user_conflict' })
  })

  it('creates the service user when it does not exist yet', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue(null)
    createMock.mockResolvedValue({
      createdAt: new Date(),
      email: 'slack-bot@arche.local',
      id: 'service-1',
      role: 'USER',
      slug: 'slack-bot',
    })

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    expect(hashMock).toHaveBeenCalledWith('generated-password')
    expect(createMock).toHaveBeenCalledWith({
      email: 'slack-bot@arche.local',
      kind: 'SERVICE',
      passwordHash: 'hashed-password',
      role: 'USER',
      slug: 'slack-bot',
    })
  })
})
