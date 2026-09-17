import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/connectors/zendesk-shared', () => ({
  normalizeZendeskSubdomain: (input: string) => input.trim().toLowerCase().replace(/\.zendesk\.com$/, ''),
}))

import {
  parseZendeskConnectorPermissions,
  parseZendeskConnectorConfig,
  validateZendeskConnectorConfig,
} from '@/lib/connectors/zendesk-config'

describe('zendesk-config', () => {
  describe('parseZendeskConnectorPermissions', () => {
    it('returns defaults when value is undefined and not required', () => {
      const result = parseZendeskConnectorPermissions(undefined)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: true,
          allowInternalComments: true,
        })
      }
    })

    it('returns error when value is undefined and required', () => {
      const result = parseZendeskConnectorPermissions(undefined, { requireAll: true })
      expect(result).toEqual({ ok: false, message: 'permissions is required' })
    })

    it('returns error when value is not an object', () => {
      const result = parseZendeskConnectorPermissions('bad')
      expect(result).toEqual({ ok: false, message: 'permissions must be an object' })
    })

    it('returns error when a key is not a boolean', () => {
      const result = parseZendeskConnectorPermissions({ allowRead: 'yes' })
      expect(result).toEqual({ ok: false, message: 'allowRead must be a boolean' })
    })

    it('parses valid permissions object', () => {
      const result = parseZendeskConnectorPermissions({
        allowRead: false,
        allowCreateTickets: false,
        allowUpdateTickets: false,
        allowPublicComments: false,
        allowInternalComments: false,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({
          allowRead: false,
          allowCreateTickets: false,
          allowUpdateTickets: false,
          allowPublicComments: false,
          allowInternalComments: false,
        })
      }
    })

    it('uses defaults for missing keys when not required', () => {
      const result = parseZendeskConnectorPermissions({ allowRead: false })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.allowRead).toBe(false)
        expect(result.value.allowCreateTickets).toBe(true)
      }
    })

    it('returns error when a required key is missing', () => {
      const result = parseZendeskConnectorPermissions({ allowRead: false }, { requireAll: true })
      expect(result).toEqual({ ok: false, message: 'allowCreateTickets is required' })
    })
  })

  describe('parseZendeskConnectorConfig', () => {
    it('parses valid config', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.subdomain).toBe('mycompany')
        expect(result.value.email).toBe('admin@example.com')
        expect(result.value.apiToken).toBe('token123')
      }
    })

    it('returns missing fields for incomplete config', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
      })
      expect(result).toEqual({ ok: false, missing: ['email', 'apiToken'] })
    })

    it('returns message for invalid subdomain', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: '-invalid-',
        email: 'admin@example.com',
        apiToken: 'token123',
      })
      expect(result).toEqual({
        ok: false,
        message: 'Subdomain must be a valid Zendesk subdomain or hostname.',
      })
    })

    it('returns permissions error when permissions are invalid', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
        permissions: { allowRead: 'yes' },
      })
      expect(result).toEqual({ ok: false, message: 'allowRead must be a boolean' })
    })
  })

  describe('validateZendeskConnectorConfig', () => {
    it('returns valid for correct config', () => {
      const result = validateZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
      })
      expect(result).toEqual({ valid: true })
    })

    it('returns invalid with missing fields', () => {
      const result = validateZendeskConnectorConfig({})
      expect(result).toEqual({ valid: false, missing: ['subdomain', 'email', 'apiToken'] })
    })

    it('accepts a legacy config without any comment type enabled', () => {
      const result = validateZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
        permissions: {
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: false,
          allowInternalComments: false,
        },
      })
      expect(result).toEqual({ valid: true })
    })
  })

  describe('canonical action permissions parsing', () => {
    const canonicalActions = {
      search_tickets: 'allow',
      get_ticket: 'allow',
      list_ticket_comments: 'allow',
      create_ticket_public: 'deny',
      create_ticket_internal: 'ask',
      update_ticket_fields: 'allow',
      update_ticket_with_public_comment: 'ask',
      update_ticket_with_internal_note: 'allow',
    }

    it('exposes a valid canonical map on the parsed config', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
        zendeskActionPermissions: { version: 1, actions: canonicalActions },
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.zendeskActionPermissions).toEqual(canonicalActions)
      }
    })

    it('omits the canonical map when it is malformed instead of failing the connector', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
        zendeskActionPermissions: { version: 1, actions: { search_tickets: 'block' } },
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.zendeskActionPermissions).toBeUndefined()
        expect(result.value.permissions.allowRead).toBe(true)
      }
    })

    it('parses configs without a canonical map', () => {
      const result = parseZendeskConnectorConfig({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        apiToken: 'token123',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.zendeskActionPermissions).toBeUndefined()
      }
    })
  })
})
