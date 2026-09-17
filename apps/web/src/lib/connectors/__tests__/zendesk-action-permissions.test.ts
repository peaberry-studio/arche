import { describe, expect, it } from 'vitest'

import {
  buildLegacyProjectionFromActionPermissions,
  mergeLegacyToolPermissions,
  normalizeZendeskActionPermissions,
  parseZendeskActionPermissionsConfig,
} from '@/lib/connectors/zendesk-action-permissions'
import {
  DEFAULT_ZENDESK_ACTION_PERMISSIONS,
  ZENDESK_ACTION_KEYS,
} from '@/lib/connectors/zendesk-types'

function legacyPermissions(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    allowRead: true,
    allowCreateTickets: true,
    allowUpdateTickets: true,
    allowPublicComments: true,
    allowInternalComments: true,
    ...overrides,
  }
}

describe('parseZendeskActionPermissionsConfig', () => {
  it('accepts a complete versioned map', () => {
    const actions = Object.fromEntries(
      ZENDESK_ACTION_KEYS.map((key, index) => [key, ['deny', 'ask', 'allow'][index % 3]])
    )
    const result = parseZendeskActionPermissionsConfig({ version: 1, actions })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ version: 1, actions })
    }
  })

  it('rejects non-object values', () => {
    expect(parseZendeskActionPermissionsConfig('bad')).toEqual({
      ok: false,
      message: 'zendeskActionPermissions must be an object',
    })
  })

  it('rejects a missing or non-1 version', () => {
    expect(parseZendeskActionPermissionsConfig({ actions: {} })).toEqual({
      ok: false,
      message: 'zendeskActionPermissions.version must be 1',
    })
    expect(parseZendeskActionPermissionsConfig({ version: 2, actions: {} })).toEqual({
      ok: false,
      message: 'zendeskActionPermissions.version must be 1',
    })
  })

  it('rejects missing actions object', () => {
    expect(parseZendeskActionPermissionsConfig({ version: 1 })).toEqual({
      ok: false,
      message: 'zendeskActionPermissions.actions must be an object',
    })
  })

  it.each(ZENDESK_ACTION_KEYS)('rejects a map missing %s', (action) => {
    const actions: Record<string, string> = {}
    for (const key of ZENDESK_ACTION_KEYS) {
      if (key !== action) actions[key] = 'allow'
    }
    expect(parseZendeskActionPermissionsConfig({ version: 1, actions })).toEqual({
      ok: false,
      message: `zendeskActionPermissions.actions.${action} is required`,
    })
  })

  it.each(ZENDESK_ACTION_KEYS)('rejects an invalid policy for %s', (action) => {
    const actions: Record<string, string> = {}
    for (const key of ZENDESK_ACTION_KEYS) {
      actions[key] = key === action ? 'block' : 'allow'
    }
    expect(parseZendeskActionPermissionsConfig({ version: 1, actions })).toEqual({
      ok: false,
      message: `zendeskActionPermissions.actions.${action} must be deny, ask or allow`,
    })
  })

  it('rejects unknown extra actions keys', () => {
    const actions: Record<string, string> = {}
    for (const key of ZENDESK_ACTION_KEYS) actions[key] = 'allow'
    actions.create_ticket = 'allow'
    const result = parseZendeskActionPermissionsConfig({ version: 1, actions })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.value.actions).sort()).toEqual([...ZENDESK_ACTION_KEYS].sort())
    }
  })
})

describe('normalizeZendeskActionPermissions', () => {
  it('defaults every action to allow when no permission fields exist', () => {
    expect(normalizeZendeskActionPermissions({ subdomain: 'x', email: 'a@b.c', apiToken: 't' }))
      .toEqual(DEFAULT_ZENDESK_ACTION_PERMISSIONS)
  })

  it('prefers a valid canonical map over legacy fields', () => {
    const actions = { ...DEFAULT_ZENDESK_ACTION_PERMISSIONS, create_ticket_public: 'deny' as const }
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions({ allowRead: false }),
      zendeskActionPermissions: { version: 1, actions },
    })
    expect(result).toEqual(actions)
  })

  it('falls back to legacy migration when the canonical map is invalid', () => {
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions({ allowPublicComments: false }),
      zendeskActionPermissions: { version: 2, actions: {} },
    })
    expect(result.create_ticket_public).toBe('deny')
    expect(result.search_tickets).toBe('allow')
  })

  it('denies every action covered by a false legacy boolean', () => {
    const cases: Array<[string, string[], Partial<Record<string, boolean>>]> = [
      ['allowRead', ['search_tickets', 'get_ticket', 'list_ticket_comments'], { allowRead: false }],
      ['allowCreateTickets', ['create_ticket_public', 'create_ticket_internal'], { allowCreateTickets: false }],
      ['allowUpdateTickets', ['update_ticket_fields', 'update_ticket_with_public_comment', 'update_ticket_with_internal_note'], { allowUpdateTickets: false }],
      ['allowPublicComments', ['create_ticket_public', 'update_ticket_with_public_comment'], { allowPublicComments: false }],
      ['allowInternalComments', ['create_ticket_internal', 'update_ticket_with_internal_note'], { allowInternalComments: false }],
    ]

    for (const [booleanKey, deniedActions, overrides] of cases) {
      const result = normalizeZendeskActionPermissions({ permissions: legacyPermissions(overrides) })
      for (const action of ZENDESK_ACTION_KEYS) {
        expect(result[action]).toBe(deniedActions.includes(action) ? 'deny' : 'allow')
      }
      expect(overrides).toHaveProperty(booleanKey)
    }
  })

  it('resolves allow < ask < deny across all applicable legacy values', () => {
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions(),
      mcpToolPermissions: { create_ticket: 'ask', update_ticket: 'deny' },
    })
    expect(result.create_ticket_public).toBe('ask')
    expect(result.create_ticket_internal).toBe('ask')
    expect(result.update_ticket_fields).toBe('deny')
    expect(result.update_ticket_with_public_comment).toBe('deny')
    expect(result.update_ticket_with_internal_note).toBe('deny')
  })

  it('migrates stored read tool policies one-to-one', () => {
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions(),
      mcpToolPermissions: { search_tickets: 'ask', get_ticket: 'deny', list_ticket_comments: 'ask' },
    })
    expect(result.search_tickets).toBe('ask')
    expect(result.get_ticket).toBe('deny')
    expect(result.list_ticket_comments).toBe('ask')
  })

  it('migrates an ask update policy when internal comments stay enabled', () => {
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions(),
      mcpToolPermissions: { update_ticket: 'ask' },
    })
    expect(result.update_ticket_fields).toBe('ask')
    expect(result.update_ticket_with_internal_note).toBe('ask')
  })

  it('denies public actions when public comments are disabled regardless of a lenient tool policy', () => {
    const result = normalizeZendeskActionPermissions({
      permissions: legacyPermissions({ allowPublicComments: false }),
      mcpToolPermissions: { create_ticket: 'allow', update_ticket: 'allow' },
    })
    expect(result.create_ticket_public).toBe('deny')
    expect(result.update_ticket_with_public_comment).toBe('deny')
    expect(result.create_ticket_internal).toBe('allow')
    expect(result.update_ticket_with_internal_note).toBe('allow')
  })
})

describe('buildLegacyProjectionFromActionPermissions', () => {
  it('projects deny-only policies to disabled legacy booleans and most-restrictive tool policies', () => {
    const actions = {
      ...DEFAULT_ZENDESK_ACTION_PERMISSIONS,
      create_ticket_public: 'deny' as const,
      update_ticket_fields: 'ask' as const,
      update_ticket_with_internal_note: 'deny' as const,
    }
    const projection = buildLegacyProjectionFromActionPermissions(actions)
    expect(projection.permissions).toEqual(
      legacyPermissions({
        allowCreateTickets: false,
        allowPublicComments: false,
        allowUpdateTickets: false,
        allowInternalComments: false,
      })
    )
    expect(projection.legacyToolPermissions).toEqual({
      search_tickets: 'allow',
      get_ticket: 'allow',
      list_ticket_comments: 'allow',
      create_ticket: 'deny',
      update_ticket: 'deny',
    })
  })

  it('never grants an older runtime broader access than the canonical map', () => {
    const cases: Array<Partial<Record<string, string>>> = [
      { create_ticket_public: 'deny' },
      { create_ticket_internal: 'deny' },
      { create_ticket_public: 'ask' },
      { update_ticket_with_public_comment: 'deny' },
      { update_ticket_with_internal_note: 'ask' },
      { search_tickets: 'deny' },
      { get_ticket: 'ask' },
      { list_ticket_comments: 'deny' },
      { update_ticket_fields: 'deny' },
    ]

    for (const overrides of cases) {
      const actions = { ...DEFAULT_ZENDESK_ACTION_PERMISSIONS, ...overrides }
      const projection = buildLegacyProjectionFromActionPermissions(actions)
      for (const [action, policy] of Object.entries(overrides)) {
        expect(policy).toBeDefined()
        if (policy === 'deny') {
          for (const booleanKey of ['allowRead', 'allowCreateTickets', 'allowUpdateTickets', 'allowPublicComments', 'allowInternalComments']) {
            if (action.includes('search') || action === 'get_ticket' || action === 'list_ticket_comments') {
              if (booleanKey === 'allowRead') expect(projection.permissions.allowRead).toBe(false)
            }
            if (action.startsWith('create_ticket')) {
              if (booleanKey === 'allowCreateTickets') expect(projection.permissions.allowCreateTickets).toBe(false)
              if (action.includes('public') && booleanKey === 'allowPublicComments') {
                expect(projection.permissions.allowPublicComments).toBe(false)
              }
              if (action.includes('internal') && booleanKey === 'allowInternalComments') {
                expect(projection.permissions.allowInternalComments).toBe(false)
              }
            }
            if (action.startsWith('update_ticket')) {
              if (booleanKey === 'allowUpdateTickets') expect(projection.permissions.allowUpdateTickets).toBe(false)
              if (action.includes('public') && booleanKey === 'allowPublicComments') {
                expect(projection.permissions.allowPublicComments).toBe(false)
              }
              if (action.includes('internal') && booleanKey === 'allowInternalComments') {
                expect(projection.permissions.allowInternalComments).toBe(false)
              }
            }
          }
        }
        if (policy === 'ask') {
          if (action === 'search_tickets') expect(projection.legacyToolPermissions.search_tickets).toBe('ask')
          if (action === 'get_ticket') expect(projection.legacyToolPermissions.get_ticket).toBe('ask')
          if (action === 'list_ticket_comments') expect(projection.legacyToolPermissions.list_ticket_comments).toBe('ask')
          if (action.startsWith('create_ticket')) expect(projection.legacyToolPermissions.create_ticket).toBe('ask')
          if (action.startsWith('update_ticket')) expect(projection.legacyToolPermissions.update_ticket).toBe('ask')
        }
      }
    }
  })

  it('merges projections over existing stored tool permissions without dropping unknown entries', () => {
    const projection = buildLegacyProjectionFromActionPermissions(DEFAULT_ZENDESK_ACTION_PERMISSIONS)
    const merged = mergeLegacyToolPermissions({ custom_tool: 'deny' }, projection.legacyToolPermissions)
    expect(merged.custom_tool).toBe('deny')
    expect(merged.create_ticket).toBe('allow')
  })

  it('merges over a null stored map', () => {
    const projection = buildLegacyProjectionFromActionPermissions(DEFAULT_ZENDESK_ACTION_PERMISSIONS)
    expect(mergeLegacyToolPermissions(null, projection.legacyToolPermissions)).toEqual(
      projection.legacyToolPermissions
    )
  })
})
