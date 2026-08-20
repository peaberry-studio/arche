import { describe, expect, it } from 'vitest'

import {
  getPermissionEventPayload,
  normalizePendingPermission,
} from '@/lib/opencode/permission'

describe('normalizePendingPermission', () => {
  it('normalizes v1 permission shape', () => {
    const result = normalizePendingPermission({
      id: 'perm-1',
      sessionID: 's1',
      permission: 'Edit file',
      patterns: ['Edit(*)'],
    })
    expect(result).toMatchObject({ id: 'perm-1', sessionId: 's1', title: 'Edit file', pattern: 'Edit(*)' })
  })

  it('falls back to sessionId when sessionID is absent', () => {
    const result = normalizePendingPermission({ id: 'perm-1', sessionId: 's2', permission: 'Read' })
    expect(result?.sessionId).toBe('s2')
  })

  it('reads messageId / callId from tool', () => {
    const result = normalizePendingPermission({
      id: 'perm-1',
      sessionID: 's1',
      permission: 'Read',
      tool: { messageID: 'm1', callID: 'c1' },
    })
    expect(result?.messageId).toBe('m1')
    expect(result?.callId).toBe('c1')
  })

  it('falls back to resources as pattern text', () => {
    const result = normalizePendingPermission({
      id: 'perm-1',
      sessionID: 's1',
      title: 'Use tool',
      resources: ['a.txt', 'b.txt'],
    })
    expect(result?.pattern).toBe('a.txt, b.txt')
  })

  it('supplies a default title', () => {
    const result = normalizePendingPermission({ id: 'perm-1', sessionID: 's1' })
    expect(result?.title).toBe('Tool approval required')
  })

  it('returns null without id or sessionId', () => {
    expect(normalizePendingPermission({ permission: 'x' })).toBeNull()
    expect(normalizePendingPermission({ id: 'p' })).toBeNull()
    expect(normalizePendingPermission(null)).toBeNull()
  })
})

describe('getPermissionEventPayload', () => {
  it('unwraps the permission object', () => {
    expect(getPermissionEventPayload({ properties: { permission: { id: 'p' } } })).toEqual({ id: 'p' })
  })

  it('unwraps the info object', () => {
    expect(getPermissionEventPayload({ properties: { info: { id: 'p' } } })).toEqual({ id: 'p' })
  })

  it('returns flat properties', () => {
    expect(getPermissionEventPayload({ properties: { id: 'p', sessionID: 's1' } })).toEqual({
      id: 'p',
      sessionID: 's1',
    })
  })

  it('returns null for non-record events', () => {
    expect(getPermissionEventPayload({})).toBeNull()
    expect(getPermissionEventPayload(null)).toBeNull()
  })
})
