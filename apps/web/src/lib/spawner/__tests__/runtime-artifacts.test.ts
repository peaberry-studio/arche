import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildMcpConfigForSlugMock = vi.fn()
const readConfigRepoSnapshotMock = vi.fn()
const findIdentityBySlugMock = vi.fn()
const getEnabledProviderCredentialsForUserMock = vi.fn()
const getEffectiveCredentialForUserMock = vi.fn()
const decryptProviderSecretMock = vi.fn()
const decryptConfigMock = vi.fn()
const findEnabledGithubConnectorsForUserMock = vi.fn()

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
    connectorService: {
      findEnabledGithubConnectorsForUser: (...args: unknown[]) => findEnabledGithubConnectorsForUserMock(...args),
    },
  }))
  vi.doMock('@/lib/connectors/crypto', () => ({
    decryptConfig: (...args: unknown[]) => decryptConfigMock(...args),
  }))
  vi.doMock('@/lib/providers/store', () => ({
    getEnabledProviderCredentialsForUser: (...args: unknown[]) => getEnabledProviderCredentialsForUserMock(...args),
    getEffectiveCredentialForUser: (...args: unknown[]) => getEffectiveCredentialForUserMock(...args),
  }))
  vi.doMock('@/lib/providers/crypto', () => ({
    decryptProviderSecret: (...args: unknown[]) => decryptProviderSecretMock(...args),
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
    getEnabledProviderCredentialsForUserMock.mockResolvedValue(new Map())
    getEffectiveCredentialForUserMock.mockResolvedValue(null)
    decryptProviderSecretMock.mockReturnValue({ apiKey: 'unused' })
    decryptConfigMock.mockReturnValue({})
    findEnabledGithubConnectorsForUserMock.mockResolvedValue([])
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
    vi.unmock('@/lib/connectors/crypto')
    vi.unmock('@/lib/providers/crypto')
    vi.unmock('@/lib/providers/store')
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
        huggingface?: { options?: { baseURL?: string } }
      }
    }

    expect(readConfigRepoSnapshotMock).toHaveBeenCalledTimes(1)
    expect(config.permission?.edit?.['opencode.json']).toBe('deny')
    expect(config.permission?.edit?.['**/.opencode/**']).toBe('deny')
    expect(config.provider?.fireworks?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(config.provider?.['fireworks-ai']?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/fireworks'
    )
    expect(config.provider?.huggingface?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/huggingface'
    )
    expect(config.provider?.ollama).toBeUndefined()
    expect(config.provider?.['opencode-go']).toBeUndefined()
    expect(artifacts.agentsMd).toContain('Slug: alice')
    expect(artifacts.agentsMd).toContain('Email: alice@example.com')
    expect(artifacts.agentsMd).toContain('## Knowledge Base write policy')
    expect(artifacts.skills.map((skill) => skill.skill.frontmatter.name)).toEqual([
      'pdf-processing',
      'arche-flow-authoring',
    ])
  })

  it('keeps proposal path, skills, and connector access for legacy all-tools agents', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        default_agent: 'assistant',
        agent: {
          assistant: { mode: 'all', tools: 'all' },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      agent?: Record<string, {
        mode?: string
        steps?: number
        tools?: Record<string, boolean>
      }>
    }

    // Legacy pre-#473 `tools: 'all'` configs are materialized up front, so the
    // surviving spawn config still has the sanctioned proposal path, skills,
    // always-on tools, and MCP connector access — with only write/edit denied.
    expect(config.agent?.assistant).toMatchObject({
      mode: 'primary',
      steps: 120,
      tools: {
        'arche_*': true,
        edit: false,
        learning_propose: true,
        skill: true,
        write: false,
      },
    })
  })

  it('normalizes the default all-mode agent before serializing runtime config', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        default_agent: 'assistant',
        agent: {
          assistant: { mode: 'all', tools: { edit: true, task: true, write: true } },
          utility: { mode: 'all', tools: { task: true } },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      agent?: Record<string, {
        mode?: string
        permission?: Record<string, string>
        steps?: number
        tools?: Record<string, boolean>
      }>
    }

    expect(config.agent?.assistant).toMatchObject({
      mode: 'primary',
      steps: 120,
      tools: { edit: false, task: true, write: false },
    })
    expect(config.agent?.utility).toMatchObject({
      mode: 'all',
      steps: 40,
      tools: { task: false },
    })
    expect(config.agent?.utility?.permission).toMatchObject({ task: 'deny' })
  })

  it('injects the system knowledge-curator agent into a config without one', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            mode: 'primary',
            tools: { read: true },
          },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      agent?: Record<string, {
        mode?: string
        steps?: number
        temperature?: number
        tools?: Record<string, boolean>
      }>
    }

    const curator = config.agent?.['knowledge-curator']
    expect(curator).toBeDefined()
    expect(curator?.mode).toBe('subagent')
    expect(curator?.steps).toBe(40)
    expect(curator?.temperature).toBeCloseTo(0.1)
    expect(curator?.tools?.read).toBe(true)
    expect(curator?.tools?.learning_propose).toBe(true)
    expect(curator?.tools?.session_history_query).toBe(true)
    expect(curator?.tools?.write).toBe(false)
    expect(curator?.tools?.edit).toBe(false)
  })

  it('injects the built-in flow authoring skill and grants runtime agent access', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            mode: 'primary',
            tools: { task: true },
          },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      agent?: Record<string, {
        permission?: { skill?: Record<string, string> }
        tools?: Record<string, boolean>
      }>
    }

    expect(artifacts.skills.map((skill) => skill.skill.frontmatter.name)).toEqual(['arche-flow-authoring'])
    expect(artifacts.skills[0]?.skill.raw).toContain('FlowDefinition')
    expect(config.agent?.assistant?.tools?.skill).toBe(true)
    expect(config.agent?.assistant?.permission?.skill?.['arche-flow-authoring']).toBe('allow')
  })

  it('injects custom connector hints after remapping runtime connector tools', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'growth',
        agent: {
          growth: {
            mode: 'primary',
            prompt: 'Investigate growth anomalies.',
            tools: {
              'arche_custom_owner-mixpanel_*': true,
            },
          },
        },
      }),
    })
    buildMcpConfigForSlugMock.mockResolvedValue({
      connectorAliases: {
        'arche_custom_owner-mixpanel': 'arche_custom_user-mixpanel',
      },
      connectorDisplayNames: {
        'arche_custom_user-mixpanel': 'Mixpanel',
      },
      connectorToolPermissions: {},
      mcpConfig: {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'arche_custom_user-mixpanel': {
            enabled: true,
            headers: { Authorization: 'Bearer token' },
            oauth: false,
            type: 'remote',
            url: 'https://custom.example/mcp',
          },
        },
      },
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      agent?: Record<string, {
        prompt?: string
        tools?: Record<string, boolean>
      }>
    }

    expect(config.agent?.growth?.tools?.['arche_custom_user-mixpanel_*']).toBe(true)
    expect(config.agent?.growth?.prompt).toContain('## Available custom connectors')
    expect(config.agent?.growth?.prompt).toContain(
      '- Mixpanel: available through MCP tools prefixed with `arche_custom_user-mixpanel_`.'
    )
  })

  it('appends enabled GitHub connector repositories to AGENTS instructions', async () => {
    await createRuntimeRepo({
      'AGENTS.md': '# Base instructions\n',
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })
    findEnabledGithubConnectorsForUserMock.mockResolvedValue([
      { config: 'encrypted-github-config' },
    ])
    decryptConfigMock.mockReturnValue({
      pat: 'github_pat_example',
      pinnedRepos: ['acme/web', 'acme/api'],
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())

    expect(findEnabledGithubConnectorsForUserMock).toHaveBeenCalledWith('user-1')
    expect(artifacts.agentsMd).toContain('## Linked Repositories')
    expect(artifacts.agentsMd).toContain('- `acme/api`')
    expect(artifacts.agentsMd).toContain('- `acme/web`')
  })

  it('ignores undecryptable and invalid GitHub connector configs when injecting repositories', async () => {
    await createRuntimeRepo({
      'AGENTS.md': '# Base instructions\n',
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })
    findEnabledGithubConnectorsForUserMock.mockResolvedValue([
      { config: 'valid-config' },
      { config: 'undecryptable-config' },
      { config: 'invalid-config' },
    ])
    decryptConfigMock.mockImplementation((config: string) => {
      if (config === 'undecryptable-config') {
        throw new Error('decrypt failed')
      }
      if (config === 'invalid-config') {
        return { pat: 'invalid', pinnedRepos: ['acme/private'] }
      }
      return { pat: 'github_pat_example', pinnedRepos: ['acme/api'] }
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())

    expect(artifacts.agentsMd).toContain('- `acme/api`')
    expect(artifacts.agentsMd).not.toContain('acme/private')
  })

  it('adds configured Ollama models to the runtime provider config', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })
    getEnabledProviderCredentialsForUserMock.mockResolvedValue(new Map([
      ['ollama', { credentialId: 'ollama-1', source: 'user', version: 1 }],
      ['opencode-go', { credentialId: 'go-1', source: 'user', version: 1 }],
    ]))
    getEffectiveCredentialForUserMock.mockImplementation(async ({ providerId }) => {
      if (providerId !== 'ollama') return null
      return {
        source: 'user',
        credential: {
          id: 'ollama-1',
          secret: 'encrypted-ollama',
          type: 'api',
          version: 1,
        },
      }
    })
    decryptProviderSecretMock.mockReturnValue({
      baseUrl: 'http://host.containers.internal:11434/v1',
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'local',
      models: [{ id: 'qwen3-coder', name: 'Qwen 3 Coder' }],
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const config = JSON.parse(artifacts.opencodeConfigContent) as {
      provider?: {
        ollama?: { models?: Record<string, { name?: string }>; options?: { baseURL?: string } }
        'opencode-go'?: { options?: { baseURL?: string } }
      }
    }

    expect(config.provider?.ollama?.options?.baseURL).toBe('http://web:3000/api/internal/providers/ollama')
    expect(config.provider?.ollama?.models).toEqual({
      'qwen3-coder': { name: 'Qwen 3 Coder' },
    })
    expect(config.provider?.['opencode-go']?.options?.baseURL).toBe(
      'http://web:3000/api/internal/providers/opencode-go'
    )
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
