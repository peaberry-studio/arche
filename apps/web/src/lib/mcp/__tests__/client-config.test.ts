import { describe, expect, it } from 'vitest'

import { buildMcpQuickConnects } from '@/lib/mcp/client-config'

describe('buildMcpQuickConnects', () => {
  it('builds quick-connect commands for supported clients', () => {
    const connects = buildMcpQuickConnects({ endpoint: 'https://arche.example.com/api/mcp', token: 'arche_pat_secret' })

    expect(connects.map((entry) => entry.id)).toEqual(['claude-code', 'codex', 'cursor'])
    expect(connects[0].command).toContain('claude mcp add arche')
    expect(connects[0].command).toContain('https://arche.example.com/api/mcp')
    expect(connects[0].command).toContain('Bearer arche_pat_secret')
  })
})
