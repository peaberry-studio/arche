import { describe, expect, it } from 'vitest'

import { canEditFlow, canManageFlow, canRunFlow, canViewFlow } from '@/lib/flows/permissions'

const owner = { id: 'owner-1', role: 'USER' }
const member = { id: 'member-1', role: 'USER' }
const admin = { id: 'admin-1', role: 'ADMIN' }

function flow(overrides: Partial<{ organizationCanRun: boolean; userId: string; visibility: 'private' | 'team' }> = {}) {
  return {
    organizationCanRun: false,
    userId: 'owner-1',
    visibility: 'private' as const,
    ...overrides,
  }
}

describe('flow permissions', () => {
  it('allows owners and admins to view, run, edit, and manage private flows', () => {
    const privateFlow = flow()

    expect(canViewFlow(owner, privateFlow)).toBe(true)
    expect(canRunFlow(owner, privateFlow)).toBe(true)
    expect(canEditFlow(owner, privateFlow)).toBe(true)
    expect(canManageFlow(owner, privateFlow)).toBe(true)

    expect(canViewFlow(admin, privateFlow)).toBe(true)
    expect(canRunFlow(admin, privateFlow)).toBe(true)
    expect(canEditFlow(admin, privateFlow)).toBe(true)
    expect(canManageFlow(admin, privateFlow)).toBe(true)
  })

  it('blocks regular members from private flows they do not own', () => {
    const privateFlow = flow()

    expect(canViewFlow(member, privateFlow)).toBe(false)
    expect(canRunFlow(member, privateFlow)).toBe(false)
    expect(canEditFlow(member, privateFlow)).toBe(false)
    expect(canManageFlow(member, privateFlow)).toBe(false)
  })

  it('allows regular members to view team flows but not edit or manage them', () => {
    const teamFlow = flow({ visibility: 'team' })

    expect(canViewFlow(member, teamFlow)).toBe(true)
    expect(canRunFlow(member, teamFlow)).toBe(false)
    expect(canEditFlow(member, teamFlow)).toBe(false)
    expect(canManageFlow(member, teamFlow)).toBe(false)
  })

  it('allows regular members to run team flows only when organization execution is enabled', () => {
    expect(canRunFlow(member, flow({ organizationCanRun: false, visibility: 'team' }))).toBe(false)
    expect(canRunFlow(member, flow({ organizationCanRun: true, visibility: 'team' }))).toBe(true)
  })
})
