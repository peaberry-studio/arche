import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetRuntimeCapabilities,
  mockIsDesktop,
  mockGetSession,
  mockValidateSameOrigin,
  mockValidateDesktopToken,
  mockRequireCapability,
  mockAuditEvent,
  mockHashArgon2,
  mockStopWorkspace,
  mockUserService,
  mockSessionService,
  mockInstanceService,
} = vi.hoisted(() => ({
  mockGetRuntimeCapabilities: vi.fn(),
  mockIsDesktop: vi.fn(),
  mockGetSession: vi.fn(),
  mockValidateSameOrigin: vi.fn(),
  mockValidateDesktopToken: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockAuditEvent: vi.fn(),
  mockHashArgon2: vi.fn(),
  mockStopWorkspace: vi.fn(),
  mockUserService: {
    findTeamMemberById: vi.fn(),
    countAdmins: vi.fn(),
    updateRole: vi.fn(),
    updatePasswordHash: vi.fn(),
    updatePasswordHashAndRevokeSessions: vi.fn(),
    deleteById: vi.fn(),
  },
  mockSessionService: {
    revokeByUserId: vi.fn(),
    revokeByUserIdExceptSession: vi.fn(),
  },
  mockInstanceService: {
    deleteBySlug: vi.fn(),
  },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mockIsDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mockValidateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-desktop-token',
  validateDesktopToken: mockValidateDesktopToken,
}))
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mockRequireCapability }))
vi.mock('@/lib/auth', () => ({ auditEvent: mockAuditEvent }))
vi.mock('@/lib/argon2', () => ({ hashArgon2: mockHashArgon2 }))
vi.mock('@/lib/runtime/workspace-host', () => ({ stopWorkspace: mockStopWorkspace }))
vi.mock('@/lib/services', () => ({
  userService: mockUserService,
  sessionService: mockSessionService,
  instanceService: mockInstanceService,
}))

import { PATCH, DELETE } from '../route'
import { POST as RESET_PASSWORD } from '../password/route'

const TEST_SESSION = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/admin/team/u2', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function makeDeleteRequest() {
  return new NextRequest('http://localhost/api/u/admin/team/u2', {
    method: 'DELETE',
    headers: { Origin: 'http://localhost' },
  })
}

function makeResetPasswordRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/admin/team/u2/password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

const TARGET_USER = {
  id: 'u2',
  email: 'bob@test.com',
  slug: 'bob',
  role: 'USER' as const,
  createdAt: new Date('2026-01-01'),
}

describe('PATCH /api/u/[slug]/team/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, teamManagement: true })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockRequireCapability.mockReturnValue(null)
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER })
  })

  it('updates user role', async () => {
    mockUserService.updateRole.mockResolvedValue({ ...TARGET_USER, role: 'ADMIN' })

    const res = await PATCH(makePatchRequest({ role: 'ADMIN' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(body.user.role).toBe('ADMIN')
    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role_updated' }),
    )
  })

  it('returns existing user when role unchanged', async () => {
    const res = await PATCH(makePatchRequest({ role: 'USER' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(body.user.role).toBe('USER')
    expect(mockUserService.updateRole).not.toHaveBeenCalled()
  })

  it('prevents demoting last admin', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER, role: 'ADMIN' })
    mockUserService.countAdmins.mockResolvedValue(1)

    const res = await PATCH(makePatchRequest({ role: 'USER' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('last_admin')
  })

  it('allows demoting admin when multiple admins exist', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER, role: 'ADMIN' })
    mockUserService.countAdmins.mockResolvedValue(2)
    mockUserService.updateRole.mockResolvedValue({ ...TARGET_USER, role: 'USER' })

    const res = await PATCH(makePatchRequest({ role: 'USER' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects non-admin', async () => {
    mockGetSession.mockResolvedValue({
      ...TEST_SESSION,
      user: { ...TEST_SESSION.user, role: 'USER' },
    })
    const res = await PATCH(makePatchRequest({ role: 'USER' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 for missing user', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ role: 'ADMIN' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects invalid role', async () => {
    const res = await PATCH(makePatchRequest({ role: 'SUPERADMIN' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/u/admin/team/u2', {
      method: 'PATCH',
      body: 'bad json',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ slug: 'admin', id: 'u2' }) })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/u/[slug]/team/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, teamManagement: true })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockRequireCapability.mockReturnValue(null)
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER })
    mockUserService.deleteById.mockResolvedValue({ count: 1 })
    mockStopWorkspace.mockResolvedValue(undefined)
    mockInstanceService.deleteBySlug.mockResolvedValue({ count: 1 })
  })

  it('deletes user, stops workspace, and audits', async () => {
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(body).toEqual({ ok: true })
    expect(mockStopWorkspace).toHaveBeenCalledWith('bob', 'admin-1')
    expect(mockInstanceService.deleteBySlug).toHaveBeenCalledWith('bob')
    expect(mockUserService.deleteById).toHaveBeenCalledWith('u2')
    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deleted' }),
    )
  })

  it('prevents deleting last admin', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER, role: 'ADMIN' })
    mockUserService.countAdmins.mockResolvedValue(1)

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(409)
  })

  it('allows deleting admin when multiple exist', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER, role: 'ADMIN' })
    mockUserService.countAdmins.mockResolvedValue(2)

    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 for missing user', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue(null)
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects non-admin', async () => {
    mockGetSession.mockResolvedValue({
      ...TEST_SESSION,
      user: { ...TEST_SESSION.user, role: 'USER' },
    })
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when deleteById returns 0', async () => {
    mockUserService.deleteById.mockResolvedValue({ count: 0 })
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(404)
  })

  it('handles stopWorkspace failure gracefully', async () => {
    mockStopWorkspace.mockRejectedValue(new Error('timeout'))
    const res = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/u/[slug]/team/[id]/password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false, teamManagement: true })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(TEST_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockRequireCapability.mockReturnValue(null)
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER })
    mockHashArgon2.mockResolvedValue('$hashed-password$')
    mockUserService.updatePasswordHash.mockResolvedValue({ ...TARGET_USER })
    mockUserService.updatePasswordHashAndRevokeSessions.mockResolvedValue(undefined)
    mockSessionService.revokeByUserId.mockResolvedValue({ count: 2 })
    mockSessionService.revokeByUserIdExceptSession.mockResolvedValue({ count: 1 })
  })

  it('resets password, revokes target sessions, and audits', async () => {
    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: 'temporary-password' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(body).toEqual({ ok: true })
    expect(mockHashArgon2).toHaveBeenCalledWith('temporary-password')
    expect(mockUserService.updatePasswordHashAndRevokeSessions).toHaveBeenCalledWith('u2', '$hashed-password$', undefined)
    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password_reset' }),
    )
  })

  it('keeps the current session when an admin resets their own password', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue({ ...TARGET_USER, id: 'admin-1' })

    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: 'temporary-password' }), {
      params: Promise.resolve({ slug: 'admin', id: 'admin-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockUserService.updatePasswordHashAndRevokeSessions).toHaveBeenCalledWith(
      'admin-1',
      '$hashed-password$',
      's1'
    )
  })

  it('rejects non-admin', async () => {
    mockGetSession.mockResolvedValue({
      ...TEST_SESSION,
      user: { ...TEST_SESSION.user, role: 'USER' },
    })

    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: 'temporary-password' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })

    expect(res.status).toBe(403)
  })

  it('rejects missing password', async () => {
    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: '' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_password')
    expect(body.message).toBe('Password is required.')
  })

  it('rejects short password', async () => {
    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: 'short' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid_password')
    expect(body.message).toBe('Password must be at least 8 characters.')
    expect(mockHashArgon2).not.toHaveBeenCalled()
  })

  it('returns 404 for missing user', async () => {
    mockUserService.findTeamMemberById.mockResolvedValue(null)

    const res = await RESET_PASSWORD(makeResetPasswordRequest({ password: 'temporary-password' }), {
      params: Promise.resolve({ slug: 'admin', id: 'u2' }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/u/admin/team/u2/password', {
      method: 'POST',
      body: 'bad json',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    })

    const res = await RESET_PASSWORD(req, { params: Promise.resolve({ slug: 'admin', id: 'u2' }) })

    expect(res.status).toBe(400)
  })
})
