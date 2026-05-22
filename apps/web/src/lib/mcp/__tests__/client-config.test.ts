import { describe, expect, it } from 'vitest'

import { buildMcpClientConfigs } from '@/lib/mcp/client-config'

describe('buildMcpClientConfigs', () => {
  it('builds quick-connect output for supported clients', () => {
    const configs = buildMcpClientConfigs({ endpoint: 'https://arche.example.com/api/mcp', token: 'arche_pat_secret' })

    expect(configs.map((config) => config.id)).toEqual(['claude-code', 'codex', 'cursor', 'generic'])
    expect(configs[0].content).toContain('https://arche.example.com/api/mcp')
    expect(configs[1].content).toContain('Bearer arche_pat_secret')
  })
})
