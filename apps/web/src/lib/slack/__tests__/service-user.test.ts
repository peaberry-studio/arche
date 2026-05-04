import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const findExistingByEmailOrSlugMock = vi.fn()

const EXPECTED_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$Rd07A5lN6/xNvx47pvH1Gw$J5TKBjCI3UOaBd2uUHMbX/AdzYT+/pvqx1io3emVwsU'

vi.mock('@/lib/services', () => ({
  userService: {
    create: (...args: unknown[]) => createMock(...args),
    findExistingByEmailOrSlug: (...args: unknown[]) => findExistingByEmailOrSlugMock(...args),
  },
}))

describe('ensureSlackServiceUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns a conflict when the existing user has a mismatched email', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue({
      email: 'other@arche.local',
      id: 'service-1',
      kind: 'SERVICE',
      role: 'USER',
      slug: 'slack-bot',
    })

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: false, error: 'service_user_conflict' })
  })

  it('returns a conflict when the existing user has a mismatched slug', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue({
      email: 'slack-bot@arche.local',
      id: 'service-1',
      kind: 'SERVICE',
      role: 'USER',
      slug: 'other-bot',
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
    expect(createMock).toHaveBeenCalledWith({
      email: 'slack-bot@arche.local',
      kind: 'SERVICE',
      passwordHash: EXPECTED_PASSWORD_HASH,
      role: 'USER',
      slug: 'slack-bot',
    })
  })

  it('retries on unique constraint error and returns the existing user', async () => {
    findExistingByEmailOrSlugMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        email: 'slack-bot@arche.local',
        id: 'service-1',
        kind: 'SERVICE',
        role: 'USER',
        slug: 'slack-bot',
      })

    createMock.mockRejectedValue({ code: 'P2002' })

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(findExistingByEmailOrSlugMock).toHaveBeenCalledTimes(2)
  })

  it('returns create_failed on non-unique errors', async () => {
    findExistingByEmailOrSlugMock.mockResolvedValue(null)
    createMock.mockRejectedValue(new Error('db down'))

    const { ensureSlackServiceUser } = await import('../service-user')
    const result = await ensureSlackServiceUser()

    expect(result).toEqual({ ok: false, error: 'service_user_create_failed' })
  })
})
