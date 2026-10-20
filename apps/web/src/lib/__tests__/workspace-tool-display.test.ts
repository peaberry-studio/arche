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

    expect(parseConnectorToolName('arche_umami_conn789_get_website_stats')).toEqual({
      connectorType: 'umami',
      connectorId: 'conn789',
      commandName: 'get_website_stats',
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
    expect(getWorkspaceToolDisplay('arche_github_conn123_list_commits')).toEqual({
      isConnectorTool: true,
      groupLabel: 'Using GitHub',
      commandLabel: 'list commits',
    })
  })

  it('leaves built-in tool names untouched', () => {
    expect(getWorkspaceToolDisplay('read')).toEqual({
      isConnectorTool: false,
      groupLabel: 'read',
    })
  })

  it.each([
    'chart_create',
    'diagram_create',
    'document_inspect',
    'email_draft',
    'flow_propose',
    'learning_propose',
    'presentation_inspect',
    'session_history_query',
    'spreadsheet_inspect',
    'spreadsheet_query',
    'spreadsheet_sample',
    'spreadsheet_stats',
  ])('uses the legacy display name for arche_tools_%s', (toolName) => {
    expect(getWorkspaceToolDisplay(`arche_tools_${toolName}`)).toEqual({
      isConnectorTool: false,
      groupLabel: toolName,
    })
    expect(getWorkspaceToolDisplay(toolName)).toEqual(getWorkspaceToolDisplay(`arche_tools_${toolName}`))
    expect(parseConnectorToolName(`arche_tools_${toolName}`)).toBeNull()
  })
})
