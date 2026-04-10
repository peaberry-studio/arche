import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildMcpConfigForSlugMock = vi.fn()
const readConfigRepoSnapshotMock = vi.fn()
const findIdentityBySlugMock = vi.fn()

let repoDir: string | null = null

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  if (!repoDir) {
    throw new Error('repo_not_configured')
  }

  const filePath = path.join(repoDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

async function createRuntimeRepo(files: Record<string, string>): Promise<void> {
  repoDir = await fs.mkdtemp(path.join(tmpdir(), 'runtime-artifacts-'))
  await Promise.all(Object.entries(files).map(([relativePath, content]) => writeRepoFile(relativePath, content)))
}

function createWorkspaceConfig(): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      agent: {},
    },
    null,
    2,
  )
}

async function loadRuntimeArtifactsModule() {
  vi.resetModules()
  vi.doMock('@/lib/config-repo-store', () => ({
    readConfigRepoSnapshot: (
      reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
    ) => readConfigRepoSnapshotMock(reader),
  }))
  vi.doMock('@/lib/services', () => ({
    userService: {
      findIdentityBySlug: (...args: unknown[]) => findIdentityBySlugMock(...args),
    },
  }))
  vi.doMock('@/lib/spawner/mcp-config', () => ({
    buildMcpConfigForSlug: (...args: unknown[]) => buildMcpConfigForSlugMock(...args),
  }))

  return import('../runtime-artifacts')
}

describe('runtime artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildMcpConfigForSlugMock.mockResolvedValue(null)
    findIdentityBySlugMock.mockResolvedValue({
      id: 'user-1',
      slug: 'alice',
      email: 'alice@example.com',
    })
    readConfigRepoSnapshotMock.mockImplementation(
      async (
        reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
      ) => {
        if (!repoDir) {
          throw new Error('repo_not_configured')
        }

        const hash = 'config-snapshot-hash'
        return {
          ok: true,
          hash,
          data: await reader({ repoDir, hash }),
        }
      }
    )
  })

  afterEach(async () => {
    if (repoDir) {
      await fs.rm(repoDir, { recursive: true, force: true })
      repoDir = null
    }

    vi.unmock('@/lib/config-repo-store')
    vi.unmock('@/lib/services')
    vi.unmock('@/lib/spawner/mcp-config')
    vi.resetModules()
  })

  it('builds the final runtime config and injected AGENTS instructions from one repo snapshot', async () => {
    await createRuntimeRepo({
      'AGENTS.md': '# Base instructions\nSlug: {{slug}}\nEmail: {{email}}\n',
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': [
        '---',
        'name: pdf-processing',
        'description: Handle PDF files',
        '---',
        'Use this for PDFs.',
      ].join('\n'),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

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

    expect(readConfigRepoSnapshotMock).toHaveBeenCalledTimes(1)
    expect(config.permission?.edit?.['opencode.json']).toBe('deny')
    expect(config.provider?.fireworks?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(config.provider?.['fireworks-ai']?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(artifacts.agentsMd).toContain('Slug: alice')
    expect(artifacts.agentsMd).toContain('Email: alice@example.com')
    expect(artifacts.skills).toHaveLength(1)
    expect(artifacts.skills[0]?.skill.frontmatter.name).toBe('pdf-processing')
  })

  it('fails when the snapshot contains a malformed skill bundle', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/README.md': '# Missing SKILL.md\n',
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    await expect(
      buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    ).rejects.toThrow('read_failed')
  })

  it('fails when the config repo snapshot cannot be read', async () => {
    readConfigRepoSnapshotMock.mockResolvedValueOnce({ ok: false, error: 'read_failed' })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    await expect(
      buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    ).rejects.toThrow('read_failed')
  })

  it('changes the runtime hash when the generated config or AGENTS content changes', async () => {
    const { hashWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()

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

    expect(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: '{"provider":{"fireworks":{}}}',
        agentsMd: '# Base instructions',
        skills: [
          {
            skill: {
              frontmatter: { name: 'pdf-processing', description: 'Handle PDFs' },
              body: 'v2',
              raw: '',
            },
            files: [{ path: 'SKILL.md', content: new TextEncoder().encode('v2') }],
          },
        ],
      })
    ).not.toBe(baseHash)
  })

  it('ignores connector gateway token rotation when hashing runtime artifacts', async () => {
    const { hashWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()

    const baseConfig = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        arche_linear_1: {
          type: 'remote',
          url: 'http://web:3000/api/internal/mcp/connectors/connector-1/mcp',
          enabled: true,
          headers: {
            Authorization: 'Bearer token-one',
          },
          oauth: false,
        },
      },
    }

    const rotatedTokenConfig = {
      ...baseConfig,
      mcp: {
        arche_linear_1: {
          ...baseConfig.mcp.arche_linear_1,
          headers: {
            Authorization: 'Bearer token-two',
          },
        },
      },
    }

    expect(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: JSON.stringify(baseConfig),
      })
    ).toBe(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: JSON.stringify(rotatedTokenConfig),
      })
    )
  })

  it('keeps external MCP authorization changes in the runtime hash', async () => {
    const { hashWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()

    const baseConfig = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        arche_linear_1: {
          type: 'remote',
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          headers: {
            Authorization: 'Bearer token-one',
          },
          oauth: false,
        },
      },
    }

    const updatedAuthConfig = {
      ...baseConfig,
      mcp: {
        arche_linear_1: {
          ...baseConfig.mcp.arche_linear_1,
          headers: {
            Authorization: 'Bearer token-two',
          },
        },
      },
    }

    expect(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: JSON.stringify(baseConfig),
      })
    ).not.toBe(
      hashWorkspaceRuntimeArtifacts({
        opencodeConfigContent: JSON.stringify(updatedAuthConfig),
      })
    )
  })
})
