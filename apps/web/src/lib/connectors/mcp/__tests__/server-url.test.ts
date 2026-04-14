import { afterEach, describe, expect, it } from 'vitest'

import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'

const originalLinearUrl = process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
const originalNotionUrl = process.env.ARCHE_CONNECTOR_NOTION_MCP_URL

describe('getConnectorMcpServerUrl', () => {
  afterEach(() => {
    if (originalLinearUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = originalLinearUrl
    }

    if (originalNotionUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_NOTION_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = originalNotionUrl
    }
  })

  it('prefers the OAuth-discovered MCP server URL when present', () => {
    const url = getConnectorMcpServerUrl('linear', {
      authType: 'oauth',
      oauth: {
        provider: 'linear',
        accessToken: 'access-token',
        clientId: 'client-1',
        mcpServerUrl: 'https://gateway.linear.example/mcp',
      },
    })

    expect(url).toBe('https://gateway.linear.example/mcp')
  })

  it('uses the configured official MCP URLs for hosted connectors', () => {
    process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = 'https://linear.internal/mcp'
    process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = 'https://notion.internal/mcp'

    expect(getConnectorMcpServerUrl('linear', {})).toBe('https://linear.internal/mcp')
    expect(getConnectorMcpServerUrl('notion', {})).toBe('https://notion.internal/mcp')
  })

  it('returns the configured custom endpoint and no URL for zendesk', () => {
    expect(getConnectorMcpServerUrl('custom', { endpoint: 'https://custom.example/mcp' })).toBe(
      'https://custom.example/mcp'
    )
    expect(getConnectorMcpServerUrl('zendesk', { subdomain: 'acme' })).toBeNull()
  })
})
