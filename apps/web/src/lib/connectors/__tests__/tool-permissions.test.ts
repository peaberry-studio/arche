import { describe, expect, it } from 'vitest'

import {
  CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY,
  getConnectorToolPermissionsForTools,
  getStoredConnectorToolPermissions,
  hasStoredConnectorToolPermissions,
  isConnectorToolPermission,
  parseConnectorToolPermissions,
  preserveConnectorToolPermissions,
  setConnectorToolPermissions,
  toConnectorToolPermissionEntries,
} from '@/lib/connectors/tool-permissions'

describe('connector tool permissions', () => {
  it('validates permission actions', () => {
    expect(isConnectorToolPermission('allow')).toBe(true)
    expect(isConnectorToolPermission('ask')).toBe(true)
    expect(isConnectorToolPermission('deny')).toBe(true)
    expect(isConnectorToolPermission('blocked')).toBe(false)
  })

  it('parses valid permission maps', () => {
    const result = parseConnectorToolPermissions(
      { search: 'ask', create: 'deny' },
      { allowedToolNames: ['search', 'create'] },
    )

    expect(result).toEqual({ ok: true, value: { search: 'ask', create: 'deny' } })
  })

  it('rejects malformed permission maps', () => {
    expect(parseConnectorToolPermissions(null).ok).toBe(false)
    expect(parseConnectorToolPermissions({ ' ': 'allow' })).toEqual({
      ok: false,
      message: 'tool names must be non-empty strings',
    })
    expect(parseConnectorToolPermissions({ search: 'bad' }).ok).toBe(false)
    expect(parseConnectorToolPermissions({ search: 'allow' }, { allowedToolNames: ['create'] })).toEqual({
      ok: false,
      message: 'Unknown connector tool: search',
    })
  })

  it('reads and writes stored permissions on connector config', () => {
    const config = setConnectorToolPermissions({ apiKey: 'key' }, { search: 'ask' })

    expect(config[CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY]).toEqual({ search: 'ask' })
    expect(hasStoredConnectorToolPermissions(config)).toBe(true)
    expect(getStoredConnectorToolPermissions(config)).toEqual({ search: 'ask' })
  })

  it('preserves connector tool permissions when replacing config', () => {
    const result = preserveConnectorToolPermissions(
      { mcpToolPermissions: { search_tickets: 'ask' } },
      { subdomain: 'acme', email: 'a@example.com', apiToken: 'token' },
    )

    expect(result.mcpToolPermissions).toEqual({ search_tickets: 'ask' })
  })

  it('does not overwrite connector tool permissions already present in next config', () => {
    const result = preserveConnectorToolPermissions(
      { mcpToolPermissions: { search_tickets: 'ask' } },
      { mcpToolPermissions: { create_ticket: 'deny' } },
    )

    expect(result.mcpToolPermissions).toEqual({ create_ticket: 'deny' })
  })

  it('defaults missing tool permissions to allow for displayed tools', () => {
    const config = setConnectorToolPermissions({}, { search: 'ask' })

    expect(getConnectorToolPermissionsForTools(config, ['search', 'create'])).toEqual({
      search: 'ask',
      create: 'allow',
    })
  })

  it('combines tool metadata with resolved permissions for UI responses', () => {
    expect(
      toConnectorToolPermissionEntries(
        [
          { name: 'search', title: 'Search', description: 'Search tickets' },
          { name: 'create', title: 'Create' },
        ],
        { search: 'ask' },
      ),
    ).toEqual([
      { name: 'search', title: 'Search', description: 'Search tickets', permission: 'ask' },
      { name: 'create', title: 'Create', description: undefined, permission: 'allow' },
    ])
  })
})
