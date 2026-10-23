import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildKickstartArtifacts } from '@/kickstart/build'
import { getKickstartTemplateById } from '@/kickstart/templates'
import { KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS } from '@/lib/learning/curator-prompt'
import { AGENT_KB_POLICY_PROMPT_BLOCK } from '@/lib/spawner/runtime-config-utils'

const buildMcpConfigForSlugMock = vi.fn()
const readConfigRepoSnapshotMock = vi.fn()
const findIdentityBySlugMock = vi.fn()
const getEnabledProviderCredentialsForUserMock = vi.fn()
const getEffectiveCredentialForUserMock = vi.fn()
const decryptProviderSecretMock = vi.fn()
const decryptConfigMock = vi.fn()
const findEnabledGithubConnectorsForUserMock = vi.fn()

let repoDir: string | null = null

type Rule = { action: string; resource: string; effect: string }
type RenderedAgent = { mode?: string; steps?: number; system?: string; request?: { body?: { temperature?: number } }; permissions?: Rule[] }
type RenderedConfig = {
  default_agent?: string
  agents?: Record<string, RenderedAgent>
  permissions?: Rule[]
  policies?: Rule[]
  plugins?: { package: string; options: { root: string } }[]
  mcp?: { servers?: Record<string, { command?: string[] } & Record<string, unknown>> }
  providers?: Record<string, { settings?: { baseURL?: string }; models?: Record<string, { name?: string }> }>
}

function parseConfig(content: string): RenderedConfig {
  return JSON.parse(content) as RenderedConfig
}

function agentOf(config: RenderedConfig, id: string): RenderedAgent {
  const agent = config.agents?.[id]
  if (!agent) throw new Error(`missing agent ${id}`)
  return agent
}

// Last matching rule wins, as in OpenCode 2.
function decision(rules: Rule[] | undefined, action: string, resource = '*'): string | undefined {
  const matches = (pattern: string, input: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(input)
  return (rules ?? []).filter((rule) => matches(rule.action, action) && matches(rule.resource, resource)).at(-1)?.effect
}

function enabledArcheTools(agent: RenderedAgent): string[] {
  const ids = new Set((agent.permissions ?? []).map((rule) => rule.action).filter((action) => action.startsWith('arche_tools_') && !action.includes('*')))
  return [...ids].filter((id) => decision(agent.permissions, id) !== 'deny').sort()
}

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
    const config = parseConfig(artifacts.opencodeConfigContent)

    expect(readConfigRepoSnapshotMock).toHaveBeenCalledTimes(1)
    expect(decision(config.policies, 'tool.use', 'edit:opencode.json')).toBe('deny')
    expect(decision(config.policies, 'tool.use', 'edit:nested/.opencode/agents/x.md')).toBe('deny')
    expect(config.providers?.fireworks?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/fireworks')
    expect(config.providers?.['fireworks-ai']?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/fireworks')
    expect(config.providers?.huggingface?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/huggingface')
    expect(config.providers?.zai?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/zai')
    expect(config.providers?.ollama).toBeUndefined()
    expect(config.providers?.['opencode-go']).toBeUndefined()
    expect(artifacts.agentsMd).toContain('Slug: alice')
    expect(artifacts.agentsMd).toContain('Email: alice@example.com')
    expect(artifacts.agentsMd).toContain('## Knowledge Base write policy')
    expect(artifacts.skills.map((skill) => skill.skill.frontmatter.name)).toEqual([
      'pdf-processing',
      'arche-flow-authoring',
    ])
  })

  it('keeps the real Kickstart assistant promises callable in the generated runtime', async () => {
    const template = getKickstartTemplateById('blank')
    expect(template).not.toBeNull()
    if (!template) return
    const kickstart = buildKickstartArtifacts({
      context: { companyName: 'Acme Labs', companyDescription: 'Analytics tools' },
      template,
      agents: [{ id: 'assistant' }],
    })
    expect(kickstart.ok).toBe(true)
    if (!kickstart.ok) return

    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': kickstart.artifacts.configContent,
      'AGENTS.md': kickstart.artifacts.agentsMdContent,
    })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', {})
    const config = parseConfig(artifacts.opencodeConfigContent)
    const assistant = agentOf(config, 'assistant')

    expect(config.default_agent).toBe('assistant')
    expect(assistant.system).toContain('call `arche_tools_learning_propose` directly')
    expect(artifacts.agentsMd).toContain('`arche_tools_chart_create`')
    for (const toolId of ['chart_create', 'diagram_create', 'email_draft', 'flow_propose', 'learning_propose']) {
      expect(decision(assistant.permissions, `arche_tools_${toolId}`), toolId).toBe('allow')
      expect(assistant.permissions?.some((rule) => rule.action === toolId), toolId).toBe(false)
    }
    expect(decision(assistant.permissions, 'arche_tools_unlisted')).toBe('deny')
    expect(decision(assistant.permissions, 'write')).toBe('deny')
    expect(decision(assistant.permissions, 'edit')).toBe('deny')
  })

  it.each(['all', undefined])('keeps proposal path, skills, and connector access for legacy tools: %s', async (tools) => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        default_agent: 'assistant',
        agent: {
          assistant: { mode: 'all', tools },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const assistant = agentOf(parseConfig(artifacts.opencodeConfigContent), 'assistant')

    // Legacy pre-#473 `tools: 'all'` configs are materialized up front, so the
    // surviving spawn config still has the sanctioned proposal path, skills,
    // always-on tools, and MCP connector access — with only write/edit denied.
    expect(assistant).toMatchObject({ mode: 'primary', steps: 120 })
    expect(decision(assistant.permissions, 'arche_linear_user_list_issues')).toBe('allow')
    expect(decision(assistant.permissions, 'arche_tools_learning_propose')).toBe('allow')
    expect(decision(assistant.permissions, 'skill', 'arche-flow-authoring')).toBe('allow')
    expect(decision(assistant.permissions, 'edit')).toBe('deny')
    expect(decision(assistant.permissions, 'write')).toBe('deny')
    expect(enabledArcheTools(assistant)).toHaveLength(14)
    expect(decision(assistant.permissions, 'arche_tools_unlisted')).toBe('deny')
  })

  it.each(['none', 'failure', 'remote'])('registers the local built-in MCP independently of connector setup: %s', async (connectorSetup) => {
    await createRuntimeRepo({ 'CommonWorkspaceConfig.json': createWorkspaceConfig() })
    const remote = { type: 'remote', enabled: true, url: 'https://connector.example/mcp' }
    if (connectorSetup === 'failure') buildMcpConfigForSlugMock.mockRejectedValueOnce(new Error('unavailable'))
    if (connectorSetup === 'remote') {
      buildMcpConfigForSlugMock.mockResolvedValueOnce({
        mcpConfig: { mcp: { arche_linear_user: remote } },
        connectorToolPermissions: {},
        connectorDisplayNames: {},
      })
    }
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', {})
    const config = parseConfig(artifacts.opencodeConfigContent)

    expect(config.mcp?.servers?.arche_tools).toEqual({
      type: 'local',
      disabled: false,
      codemode: false,
      command: ['node', '/opt/arche/arche-tools/server.js'],
    })
    expect(decision(config.permissions, 'arche_tools_chart_create')).toBe('deny')
    if (connectorSetup === 'remote') {
      expect(config.mcp?.servers?.arche_linear_user).toEqual({ type: 'remote', disabled: false, codemode: false, url: remote.url })
    }
  })

  it('supports a desktop command override through both runtime APIs', async () => {
    const commonConfigContent = createWorkspaceConfig()
    await createRuntimeRepo({ 'CommonWorkspaceConfig.json': commonConfigContent })
    const options = { archeToolsCommand: ['/desktop/bin/node', '/desktop/bin/arche-tools/server.js'] }
    const { buildWorkspaceRuntimeArtifacts, buildWorkspaceRuntimeConfig } = await loadRuntimeArtifactsModule()
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', {}, options)
    const config = await buildWorkspaceRuntimeConfig('alice', {}, commonConfigContent, null, options)

    expect(parseConfig(artifacts.opencodeConfigContent).mcp?.servers?.arche_tools?.command).toEqual(options.archeToolsCommand)
    expect(config.mcp).toMatchObject({ servers: { arche_tools: { command: options.archeToolsCommand } } })
  })

  it('allows the tool-output directory passed by the runtime host instead of the container default', async () => {
    await createRuntimeRepo({ 'CommonWorkspaceConfig.json': createWorkspaceConfig() })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const toolOutputDirectory = '/Users/ada/.arche/.local/share/opencode/tool-output'
    const v2 = parseConfig((await buildWorkspaceRuntimeArtifacts('alice', {}, { toolOutputDirectory })).opencodeConfigContent)

    expect(decision(v2.permissions, 'external_directory', `${toolOutputDirectory}/tool_1`)).toBe('allow')
    expect(decision(v2.permissions, 'external_directory', '/home/workspace/.local/share/opencode/tool-output/tool_1')).toBe('ask')
  })

  it('renders protected artifacts with agent prompts, self-delegation denies, and guard policies', async () => {
    await createRuntimeRepo({
      'AGENTS.md': '# Workspace',
      'CommonWorkspaceConfig.json': JSON.stringify({
        default_agent: 'analyst',
        agent: {
          analyst: { tools: { read: true, task: true, spreadsheet_query: true } },
          reviewer: { mode: 'subagent', tools: { read: true, task: true } },
        },
      }),
    })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const v2 = parseConfig((await buildWorkspaceRuntimeArtifacts('alice', {})).opencodeConfigContent)

    expect(Object.keys(v2.agents ?? {}).sort()).toEqual(['analyst', 'knowledge-curator', 'reviewer'])
    expect(v2.plugins).toEqual([{ package: '/opt/arche/arche-tools/shared/scratch-isolation', options: { root: '/tmp/arche-scratch' } }])
    for (const [id, agent] of Object.entries(v2.agents ?? {})) {
      expect(agent.system, id).toContain(`Your current agent id is "${id}".`)
      expect(agent.system?.endsWith(AGENT_KB_POLICY_PROMPT_BLOCK), id).toBe(true)
      expect(agent.permissions?.findLast((rule) => rule.action === 'subagent')).toEqual({ action: 'subagent', resource: id, effect: 'deny' })
      expect(decision(agent.permissions, 'external_directory', '/tmp/arche-scratch/ses_1/draft.md'), id).toBe('ask')
      expect(decision(agent.permissions, 'external_directory', '/etc/passwd'), id).toBe('ask')
      expect(decision(agent.permissions, 'external_directory', '/home/workspace/.local/share/opencode/tool-output/tool_1'), id).toBe('allow')
      expect(decision(agent.permissions, 'external_directory', '/home/workspace/.local/share/opencode/auth.json'), id).toBe('ask')
    }
    expect(decision(v2.permissions, 'external_directory', '/home/workspace/.local/share/opencode/tool-output/tool_1')).toBe('allow')
    // No write tool, no scratch writes: the allowance never widens an agent's tools.
    expect(decision(agentOf(v2, 'analyst').permissions, 'edit', '../tmp/arche-scratch/ses_1/draft.md')).toBe('deny')
    expect(v2.policies).toEqual(expect.arrayContaining([
      { action: 'tool.use', resource: 'edit:.opencode/**', effect: 'deny' },
      { action: 'tool.use', resource: 'edit:opencode.json', effect: 'deny' },
      { action: 'tool.use', resource: 'shell:*opencode.json*', effect: 'deny' },
    ]))
    expect(v2.policies?.slice(-3)).toEqual([
      { action: 'tool.use', resource: 'edit:*', effect: 'deny' },
      { action: 'tool.use', resource: 'edit:../tmp/arche-scratch/*', effect: 'allow' },
      { action: 'tool.use', resource: 'edit:/tmp/arche-scratch/*', effect: 'allow' },
    ])
  })

  it.each([
    { permission: { read: 'invalid' } },
    { permission: 123 },
    { tools: { unknown: false } },
  ])('rejects unsupported authored security settings before transforms can overwrite them', async (agent) => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({ agent: { worker: agent } }),
    })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    await expect(buildWorkspaceRuntimeArtifacts('alice', {}))
      .rejects.toMatchObject({ code: 'runtime_config_unsupported' })
  })

  it('rejects malformed source JSON instead of producing an unrestricted fallback', async () => {
    await createRuntimeRepo({ 'CommonWorkspaceConfig.json': '{ invalid' })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    await expect(buildWorkspaceRuntimeArtifacts('alice', {}))
      .rejects.toMatchObject({ code: 'runtime_config_unsupported' })
  })

  it('keeps only spreadsheet tools enabled for an explicit agent and remaps its permissions', async () => {
    const storedConfig = {
      default_agent: 'analyst',
      agent: {
        analyst: {
          tools: {
            'arche_*': true,
            spreadsheet_inspect: true,
            spreadsheet_sample: true,
            spreadsheet_query: true,
            spreadsheet_stats: true,
            chart_create: false,
            diagram_create: false,
            email_draft: false,
            flow_propose: false,
            learning_propose: false,
            scratch_dir: false,
            scratch_publish: false,
            session_history_query: false,
          },
          permission: { '*': 'allow', spreadsheet_query: 'ask' },
        },
        restricted: { tools: { chart_create: false, diagram_create: false, email_draft: false, flow_propose: false, learning_propose: false, scratch_dir: false, scratch_publish: false, session_history_query: false }, permission: 'allow' },
      },
    }
    await createRuntimeRepo({ 'CommonWorkspaceConfig.json': JSON.stringify(storedConfig) })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', {})
    const config = parseConfig(artifacts.opencodeConfigContent)
    const analyst = agentOf(config, 'analyst')

    expect(enabledArcheTools(analyst)).toEqual([
      'arche_tools_spreadsheet_inspect',
      'arche_tools_spreadsheet_query',
      'arche_tools_spreadsheet_sample',
      'arche_tools_spreadsheet_stats',
    ])
    expect(decision(analyst.permissions, 'arche_tools_spreadsheet_query')).toBe('ask')
    expect(analyst.permissions?.some((rule) => rule.action === 'spreadsheet_query')).toBe(false)
    for (const id of ['chart_create', 'diagram_create', 'document_inspect', 'email_draft', 'flow_propose', 'learning_propose', 'presentation_inspect', 'session_history_query']) {
      expect(decision(analyst.permissions, `arche_tools_${id}`), id).toBe('deny')
    }
    expect(decision(analyst.permissions, 'arche_tools_unlisted')).toBe('deny')
    expect(enabledArcheTools(agentOf(config, 'restricted'))).toEqual([])
    expect(analyst.system).toContain('Your current agent id is "analyst".')
    expect(analyst.system).toContain('prefill caller_agent with this exact agent id')
    expect(analyst.system).toContain('Never guess an agent or session id')
    expect(analyst.system).toContain('Do not assume the harness forwards session metadata')
    expect(analyst.system).toContain('caller_identity_unavailable')
    expect(analyst.system?.endsWith(AGENT_KB_POLICY_PROMPT_BLOCK)).toBe(true)
  })

  it.each([
    { permission: 'ask', document: 'ask' },
    { permission: { '*': 'ask', document_inspect: 'deny' }, document: 'deny' },
  ])('preserves inherited permissions through the runtime pipeline: $document', async ({ permission, document }) => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        permission,
        default_agent: 'analyst',
        agent: { analyst: { tools: { document_inspect: true, spreadsheet_query: true } } },
      }),
    })
    const { buildWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', {})
    const config = parseConfig(artifacts.opencodeConfigContent)
    const analyst = agentOf(config, 'analyst')

    expect(decision(config.permissions, 'read')).toBe('ask')
    expect(decision(analyst.permissions, 'arche_tools_document_inspect')).toBe(document)
    expect(decision(analyst.permissions, 'arche_tools_spreadsheet_query')).toBe('ask')
    expect(decision(analyst.permissions, 'arche_tools_presentation_inspect')).toBe('deny')
    expect(decision(analyst.permissions, 'arche_tools_unlisted')).toBe('deny')
    expect(decision(analyst.permissions, 'unlisted_tool')).toBe('deny')
    expect(decision(analyst.permissions, 'arche_tools_chart_create')).not.toBe('deny')
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
    const config = parseConfig(artifacts.opencodeConfigContent)
    const assistant = agentOf(config, 'assistant')
    const utility = agentOf(config, 'utility')

    expect(assistant).toMatchObject({ mode: 'primary', steps: 120 })
    expect(decision(assistant.permissions, 'edit')).toBe('deny')
    expect(decision(assistant.permissions, 'write')).toBe('deny')
    expect(decision(assistant.permissions, 'subagent', 'utility')).toBe('allow')
    expect(utility).toMatchObject({ mode: 'all', steps: 40 })
    expect(decision(utility.permissions, 'subagent', 'assistant')).toBe('deny')
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
    const curator = agentOf(parseConfig(artifacts.opencodeConfigContent), 'knowledge-curator')

    expect(curator.mode).toBe('subagent')
    expect(curator.steps).toBe(40)
    expect(curator.request?.body?.temperature).toBeCloseTo(0.1)
    expect(decision(curator.permissions, 'read')).toBe('allow')
    expect(decision(curator.permissions, 'arche_tools_learning_propose')).toBe('allow')
    expect(decision(curator.permissions, 'arche_tools_session_history_query')).toBe('allow')
    expect(decision(curator.permissions, 'write')).toBe('deny')
    expect(decision(curator.permissions, 'edit')).toBe('deny')
  })

  it('appends the KB policy block to every agent prompt and keeps write/edit denied', async () => {
    await createRuntimeRepo({
      'CommonWorkspaceConfig.json': JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            mode: 'primary',
            prompt: 'Delegate SIEMPRE en knowledge-curator.',
            tools: { task: true },
          },
          worker: {
            mode: 'subagent',
            prompt: 'Handle Linear work.',
            tools: { read: true },
          },
          'knowledge-curator': {
            mode: 'subagent',
            prompt: 'Edit vault .md files directly.',
          },
          helper: { mode: 'subagent' },
        },
      }),
    })

    const {
      buildWorkspaceRuntimeArtifacts,
      getWebProviderGatewayConfig,
    } = await loadRuntimeArtifactsModule()

    const artifacts = await buildWorkspaceRuntimeArtifacts('alice', getWebProviderGatewayConfig())
    const agents = parseConfig(artifacts.opencodeConfigContent).agents ?? {}

    expect(Object.keys(agents).sort()).toEqual(['assistant', 'helper', 'knowledge-curator', 'worker'])
    for (const [agentId, agent] of Object.entries(agents)) {
      const prompt = agent.system ?? ''
      expect(prompt.split('## Knowledge Base write policy'), agentId).toHaveLength(2)
      expect(prompt.endsWith(AGENT_KB_POLICY_PROMPT_BLOCK), agentId).toBe(true)
      expect(decision(agent.permissions, 'write'), agentId).toBe('deny')
      expect(decision(agent.permissions, 'edit'), agentId).toBe('deny')
    }
    expect(agents.assistant?.system?.startsWith('Delegate SIEMPRE en knowledge-curator.')).toBe(true)

    // The stale stored curator prompt was replaced by the canonical persona,
    // with the policy block still appended after it.
    const curator = agents['knowledge-curator']
    expect(curator?.system?.startsWith('Edit vault .md files directly.')).toBe(false)
    expect(curator?.system?.startsWith(KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS)).toBe(true)
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
    const assistant = agentOf(parseConfig(artifacts.opencodeConfigContent), 'assistant')

    expect(artifacts.skills.map((skill) => skill.skill.frontmatter.name)).toEqual(['arche-flow-authoring'])
    expect(artifacts.skills[0]?.skill.raw).toContain('FlowDefinition')
    expect(decision(assistant.permissions, 'skill', 'arche-flow-authoring')).toBe('allow')
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
    const growth = agentOf(parseConfig(artifacts.opencodeConfigContent), 'growth')

    expect(decision(growth.permissions, 'arche_custom_user-mixpanel_query')).toBe('allow')
    expect(decision(growth.permissions, 'arche_custom_owner-mixpanel_query')).toBe('deny')
    expect(growth.system).toContain('## Available custom connectors')
    expect(growth.system).toContain(
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
    const config = parseConfig(artifacts.opencodeConfigContent)

    expect(config.providers?.ollama?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/ollama')
    expect(config.providers?.ollama?.models).toEqual({
      'qwen3-coder': { name: 'Qwen 3 Coder' },
    })
    expect(config.providers?.['opencode-go']?.settings?.baseURL).toBe('http://web:3000/api/internal/providers/opencode-go')
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

  it.each([
    { url: 'http://web:3000/api/internal/mcp/connectors/connector-1/mcp', sameHash: true },
    { url: 'http://127.0.0.1:4097/mcp/connectors/connector-1', sameHash: true },
    { url: 'https://external.example/mcp', sameHash: false },
  ])('hashes native V2 MCP auth rotation with the same gateway-only normalization: $sameHash', async ({ url, sameHash }) => {
    const { hashWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const hash = (token: string) => hashWorkspaceRuntimeArtifacts({
      opencodeConfigContent: JSON.stringify({
        mcp: { servers: { arche_linear_1: { type: 'remote', url, headers: { Authorization: `Bearer ${token}` } } } },
      }),
    })
    expect(hash('first') === hash('second')).toBe(sameHash)
  })

  it('ignores an assigned Desktop proxy port but retains connector identity in the hash', async () => {
    const { hashWorkspaceRuntimeArtifacts } = await loadRuntimeArtifactsModule()
    const hash = (port: number, id: string) => hashWorkspaceRuntimeArtifacts({
      opencodeConfigContent: JSON.stringify({ mcp: { servers: { connector: {
        type: 'remote', url: `http://127.0.0.1:${port}/mcp/connectors/${id}`,
        headers: { Authorization: 'Bearer fixture' },
      } } } }),
    })
    expect(hash(4097, 'first')).toBe(hash(49152, 'first'))
    expect(hash(4097, 'first')).not.toBe(hash(4097, 'second'))
  })
})
