import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: vi.fn().mockResolvedValue({
    ok: true,
    content: JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      agent: {},
    }),
  }),
  readConfigRepoFile: vi.fn().mockResolvedValue({
    ok: true,
    content: '# Base instructions',
  }),
}))

vi.mock('@/lib/services', () => ({
  userService: {
    findIdentityBySlug: vi.fn().mockResolvedValue({
      id: 'user-1',
      slug: 'alice',
      email: 'alice@example.com',
    }),
  },
}))

vi.mock('../mcp-config', () => ({
  buildMcpConfigForSlug: vi.fn().mockResolvedValue(null),
}))

import {
  buildWorkspaceRuntimeArtifacts,
  getWebProviderGatewayConfig,
  hashWorkspaceRuntimeArtifacts,
} from '../runtime-artifacts'

describe('runtime artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the final runtime config and injected AGENTS instructions', async () => {
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      permission?: {
        edit?: Record<string, string>
      }
      provider?: {
        fireworks?: { options?: { baseURL?: string } }
        'fireworks-ai'?: { options?: { baseURL?: string } }
      }
    }

    expect(config.permission?.edit?.['opencode.json']).toBe('deny')
    expect(config.provider?.fireworks?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(config.provider?.['fireworks-ai']?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(artifacts.agentsMd).toContain('Slug: alice')
    expect(artifacts.agentsMd).toContain('Email: alice@example.com')
  })

  it('changes the runtime hash when the generated config or AGENTS content changes', () => {
    const baseHash = hashWorkspaceRuntimeArtifacts({
      opencodeConfigContent: '{"provider":{"fireworks":{}}}',
      agentsMd: '# Base instructions',
    })

    expect(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: '{"provider":{"fireworks-ai":{}}}',
        agentsMd: '# Base instructions',
      })
    ).not.toBe(baseHash)

    expect(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: '{"provider":{"fireworks":{}}}',
        agentsMd: '# Updated instructions',
      })
    ).not.toBe(baseHash)
  })
})
