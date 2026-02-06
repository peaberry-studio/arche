import { describe, it, expect } from 'vitest'
import { encryptConfig } from '@/lib/connectors/crypto'
import { buildMcpConfigFromConnectors } from '@/lib/spawner/mcp-config'

describe('mcp-config', () => {
  it('builds MCP config for enabled connectors', () => {
    const connectors = [
      {
        id: 'c1',
        type: 'github',
        name: 'GitHub',
        enabled: true,
        config: encryptConfig({ token: 'ghp_123' }),
      },
      {
        id: 'c2',
        type: 'slack',
        name: 'Slack',
        enabled: true,
        config: encryptConfig({ botToken: 'xoxb-1', teamId: 'T123', appToken: 'xapp-1' }),
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

    expect(result.mcp.arche_github_c1).toEqual({
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-github'],
      enabled: true,
      environment: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_123' },
    })

    expect(result.mcp.arche_slack_c2).toEqual({
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-slack'],
      enabled: true,
      environment: {
        SLACK_BOT_TOKEN: 'xoxb-1',
        SLACK_TEAM_ID: 'T123',
        SLACK_APP_TOKEN: 'xapp-1',
      },
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
        type: 'github',
        name: 'GitHub Bad',
        enabled: true,
        config: encryptConfig({ token: 123 }),
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
        type: 'github',
        name: 'GitHub OK',
        enabled: true,
        config: encryptConfig({ token: 'ghp_ok' }),
      },
    ]

    const result = buildMcpConfigFromConnectors(connectors)

    expect(result.mcp.arche_github_ok1).toEqual({
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-github'],
      enabled: true,
      environment: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_ok' },
    })

    expect(result.mcp.arche_github_bad1).toBeUndefined()
    expect(result.mcp.arche_custom_bad2).toBeUndefined()
  })

  it('uses full connector id in MCP keys to avoid collisions', () => {
    const connectors = [
      {
        id: 'abcdef12-1111',
        type: 'github',
        name: 'GitHub One',
        enabled: true,
        config: encryptConfig({ token: 'ghp_one' }),
      },
      {
        id: 'abcdef12-2222',
        type: 'github',
        name: 'GitHub Two',
        enabled: true,
        config: encryptConfig({ token: 'ghp_two' }),
      },
    ]

    const result = buildMcpConfigFromConnectors(connectors)
    const keys = Object.keys(result.mcp).sort()

    expect(keys).toEqual(['arche_github_abcdef12-1111', 'arche_github_abcdef12-2222'])
  })
})
