import { describe, it, expect } from 'vitest'
import { encryptConfig } from '@/lib/connectors/crypto'
import { buildMcpConfigFromConnectors } from '@/lib/spawner/mcp-config'

describe('mcp-config', () => {
  it('builds MCP config for enabled connectors', () => {
    const connectors = [
      {
        id: 'c1',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        config: encryptConfig({
          authType: 'oauth',
          oauth: { provider: 'linear', clientId: 'client-linear', accessToken: 'lin_oauth_token' },
        }),
      },
      {
        id: 'c2',
        type: 'notion',
        name: 'Notion',
        enabled: true,
        config: encryptConfig({
          authType: 'oauth',
          oauth: { provider: 'notion', clientId: 'client-notion', accessToken: 'notion_oauth_token' },
        }),
      },
      {
        id: 'c3',
        type: 'custom',
        name: 'Custom',
        enabled: true,
        config: encryptConfig({
          endpoint: 'https://api.example.com/mcp',
          headers: { 'X-Token': 'abc' },
          auth: 'secret',
        }),
      },
    ]

    const result = buildMcpConfigFromConnectors(connectors)

    expect(result.mcp.arche_linear_c1).toEqual({
      type: 'remote',
      url: 'https://mcp.linear.app/mcp',
      enabled: true,
      headers: {
        Authorization: 'Bearer lin_oauth_token',
      },
      oauth: false,
    })

    expect(result.mcp.arche_notion_c2).toEqual({
      type: 'remote',
      url: 'https://mcp.notion.com/mcp',
      enabled: true,
      headers: {
        Authorization: 'Bearer notion_oauth_token',
      },
      oauth: false,
    })

    expect(result.mcp.arche_custom_c3).toEqual({
      type: 'remote',
      url: 'https://api.example.com/mcp',
      enabled: true,
      oauth: false,
      headers: {
        'X-Token': 'abc',
        Authorization: 'Bearer secret',
      },
    })
  })

  it('skips connectors when required fields are not strings', () => {
    const connectors = [
      {
        id: 'bad1',
        type: 'linear',
        name: 'Linear Bad',
        enabled: true,
        config: encryptConfig({ apiKey: 123 }),
      },
      {
        id: 'bad2',
        type: 'custom',
        name: 'Custom Bad',
        enabled: true,
        config: encryptConfig({ endpoint: { url: 'https://example.com' } }),
      },
      {
        id: 'ok1',
        type: 'linear',
        name: 'Linear OK',
        enabled: true,
        config: encryptConfig({
          authType: 'oauth',
          oauth: { provider: 'linear', clientId: 'client-linear', accessToken: 'lin_oauth_token' },
        }),
      },
    ]

    const result = buildMcpConfigFromConnectors(connectors)

    expect(result.mcp.arche_linear_ok1).toEqual({
      type: 'remote',
      url: 'https://mcp.linear.app/mcp',
      enabled: true,
      headers: {
        Authorization: 'Bearer lin_oauth_token',
      },
      oauth: false,
    })

    expect(result.mcp.arche_linear_bad1).toBeUndefined()
    expect(result.mcp.arche_custom_bad2).toBeUndefined()
  })

  it('uses full connector id in MCP keys to avoid collisions', () => {
    const connectors = [
      {
        id: 'abcdef12-1111',
        type: 'linear',
        name: 'Linear One',
        enabled: true,
        config: encryptConfig({
          authType: 'oauth',
          oauth: { provider: 'linear', clientId: 'client-linear', accessToken: 'token_one' },
        }),
      },
      {
        id: 'abcdef12-2222',
        type: 'linear',
        name: 'Linear Two',
        enabled: true,
        config: encryptConfig({
          authType: 'oauth',
          oauth: { provider: 'linear', clientId: 'client-linear', accessToken: 'token_two' },
        }),
      },
    ]

    const result = buildMcpConfigFromConnectors(connectors)
    const keys = Object.keys(result.mcp).sort()

    expect(keys).toEqual(['arche_linear_abcdef12-1111', 'arche_linear_abcdef12-2222'])
  })
})
