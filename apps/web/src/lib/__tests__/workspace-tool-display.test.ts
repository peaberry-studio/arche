import { describe, expect, it } from 'vitest'

import {
  formatConnectorCommandName,
  getWorkspaceToolDisplay,
  parseConnectorToolName,
} from '@/lib/workspace-tool-display'

describe('workspace-tool-display', () => {
  it('parses connector tool names', () => {
    expect(parseConnectorToolName('arche_notion_conn123_list_teams')).toEqual({
      connectorType: 'notion',
      connectorId: 'conn123',
      commandName: 'list_teams',
    })

    expect(parseConnectorToolName('arche_zendesk_conn456_search_tickets')).toEqual({
      connectorType: 'zendesk',
      connectorId: 'conn456',
      commandName: 'search_tickets',
    })
  })

  it('formats connector commands into readable labels', () => {
    expect(formatConnectorCommandName('list_teams')).toBe('list teams')
    expect(formatConnectorCommandName('get-user')).toBe('get user')
  })

  it('prefers connector names when available', () => {
    expect(
      getWorkspaceToolDisplay('arche_notion_conn123_list_teams', {
        conn123: 'Product Notion',
      })
    ).toEqual({
      isConnectorTool: true,
      groupLabel: 'Using Product Notion',
      commandLabel: 'list teams',
    })
  })

  it('falls back to connector type labels when no connector name exists', () => {
    expect(getWorkspaceToolDisplay('arche_linear_conn123_get_issue')).toEqual({
      isConnectorTool: true,
      groupLabel: 'Using Linear',
      commandLabel: 'get issue',
    })
  })

  it('leaves built-in tool names untouched', () => {
    expect(getWorkspaceToolDisplay('read')).toEqual({
      isConnectorTool: false,
      groupLabel: 'read',
    })
  })
})
