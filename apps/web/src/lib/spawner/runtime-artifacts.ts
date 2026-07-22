import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { readConfigRepoSnapshot } from '@/lib/config-repo-store'
import { readCommonWorkspaceConfig, readConfigRepoFile } from '@/lib/common-workspace-config-store'
import { decryptConfig } from '@/lib/connectors/crypto'
import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import { parseGithubConnectorConfig } from '@/lib/connectors/github'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import { isOllamaSecret } from '@/lib/providers/ollama'
import { getEffectiveCredentialForUser, getEnabledProviderCredentialsForUser } from '@/lib/providers/store'
import { isRecord } from '@/lib/records'
import { readSkillBundlesFromRepoDir } from '@/lib/skills/skill-store'
import {
  SYSTEM_FLOW_AUTHORING_SKILL_NAME,
  withSystemSkillBundles,
} from '@/lib/skills/system-skills'
import type { SkillBundle } from '@/lib/skills/types'
import { connectorService, userService } from '@/lib/services'
import {
  applyDefaultAgentModel,
  injectAlwaysOnAgentTools,
  injectCustomConnectorHints,
  injectSelfDelegationGuards,
  injectSystemSkillAccess,
  remapAgentConnectorTools,
} from '@/lib/spawner/agent-config-transforms'
import { buildMcpConfigForSlug } from '@/lib/spawner/mcp-config'
import {
  withWorkspaceIdentity,
  withLinkedRepositories,
  withWorkspacePermissionGuards,
} from '@/lib/spawner/runtime-config-utils'
import {
  parseRuntimeConfigContent,
  serializeRuntimeConfig,
} from './runtime-config'

export {
  getDefaultWebRuntimeConfigContent,
  getWebProviderGatewayConfig,
  parseRuntimeConfigContent,
  serializeRuntimeConfig,
} from './runtime-config'

type WorkspaceOwner = {
  id: string
  slug: string
  email: string | null
} | null

export type WorkspaceRuntimeArtifacts = {
  skills: SkillBundle[]
  owner: WorkspaceOwner
  opencodeConfigContent: string
  agentsMd?: string
}

const COMMON_WORKSPACE_CONFIG_FILE = 'CommonWorkspaceConfig.json'
const CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS = ['ollama', 'opencode-go'] as const

type ConfiguredOnlyRuntimeProviderId = (typeof CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS)[number]

function normalizeRuntimeConfigForHash(configContent: string): string {
  try {
    const parsed = parseRuntimeConfigContent(configContent)
    const mcp = parsed.mcp
    if (!isRecord(mcp)) {
      return configContent
    }

    const connectorGatewayBaseUrl = getConnectorGatewayBaseUrl()
    let changed = false
    const normalizedMcp = Object.fromEntries(
      Object.entries(mcp).map(([key, value]) => {
        if (!isRecord(value)) {
          return [key, value]
        }

        const url = value.url
        const headers = value.headers
        const normalizedHeaders = isRecord(headers) ? headers : null
        const authorization = normalizedHeaders?.Authorization
        if (
          typeof url !== 'string' ||
          !url.startsWith(`${connectorGatewayBaseUrl}/`) ||
          typeof authorization !== 'string' ||
          !authorization.startsWith('Bearer ')
        ) {
          return [key, value]
        }

        changed = true
        return [
          key,
          {
            ...value,
            headers: {
              ...normalizedHeaders,
              Authorization: 'Bearer <connector-gateway-token>',
            },
          },
        ]
      })
    )

    return changed
      ? serializeRuntimeConfig({ ...parsed, mcp: normalizedMcp })
      : configContent
  } catch {
    return configContent
  }
}

async function getWorkspaceOwner(slug: string): Promise<WorkspaceOwner> {
  return userService.findIdentityBySlug(slug).catch(() => null)
}

async function getLinkedRepositoriesForOwner(owner: WorkspaceOwner): Promise<string[]> {
  if (!owner) return []

  try {
    const connectors = await connectorService.findEnabledGithubConnectorsForUser(owner.id)
    const repos: string[] = []

    for (const connector of connectors) {
      try {
        const parsed = parseGithubConnectorConfig(decryptConfig(connector.config))
        if (parsed.ok) repos.push(...parsed.config.pinnedRepos)
      } catch {
        continue
      }
    }

    return Array.from(new Set(repos)).sort((left, right) => left.localeCompare(right))
  } catch (error) {
    console.warn('[workspace-runtime] Failed to load linked GitHub repositories', error)
    return []
  }
}

async function readOptionalRepoTextFile(repoDir: string, filePath: string): Promise<string | null> {
  return fs.readFile(path.join(repoDir, filePath), 'utf-8').catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  })
}

async function readRuntimeRepoSnapshot(): Promise<{
  agentsMdContent: string | null
  commonConfigContent: string | null
  skills: SkillBundle[]
}> {
  const snapshot = await readConfigRepoSnapshot(async ({ repoDir }) => {
    const [agentsMdContent, commonConfigContent, skills] = await Promise.all([
      readOptionalRepoTextFile(repoDir, 'AGENTS.md'),
      readOptionalRepoTextFile(repoDir, COMMON_WORKSPACE_CONFIG_FILE),
      readSkillBundlesFromRepoDir(repoDir, { strict: true }),
    ])

    return {
      agentsMdContent,
      commonConfigContent,
      skills,
    }
  })

  if (!snapshot.ok) {
    throw new Error(snapshot.error)
  }

  return snapshot.data
}

async function buildBaseWorkspaceConfig(
  slug: string,
  commonConfigContent?: string | null
): Promise<Record<string, unknown>> {
  let baseConfig: Record<string, unknown> = {}

  const commonConfigResult = typeof commonConfigContent === 'undefined'
    ? await readCommonWorkspaceConfig().catch(() => null)
    : commonConfigContent == null
      ? null
      : { ok: true as const, content: commonConfigContent }

  if (commonConfigResult?.ok) {
    try {
      baseConfig = parseRuntimeConfigContent(commonConfigResult.content)
    } catch {
      console.warn('[workspace-runtime] Failed to parse CommonWorkspaceConfig')
    }
  }

  try {
    const mcpResult = await buildMcpConfigForSlug(slug)
    if (mcpResult && Object.keys(mcpResult.mcpConfig.mcp).length > 0) {
      const userMcpKeys = new Set(Object.keys(mcpResult.mcpConfig.mcp))
      baseConfig = remapAgentConnectorTools(
        baseConfig,
        userMcpKeys,
        mcpResult.connectorToolPermissions,
        mcpResult.connectorAliases,
      )
      baseConfig = injectCustomConnectorHints(baseConfig, mcpResult.connectorDisplayNames)
      baseConfig = { ...baseConfig, mcp: mcpResult.mcpConfig.mcp }
    } else {
      baseConfig = remapAgentConnectorTools(baseConfig, new Set())
    }
  } catch {
    console.warn('[workspace-runtime] Failed to build MCP config')
    baseConfig = remapAgentConnectorTools(baseConfig, new Set())
  }

  baseConfig = injectAlwaysOnAgentTools(baseConfig)
  baseConfig = injectSystemSkillAccess(baseConfig, [SYSTEM_FLOW_AUTHORING_SKILL_NAME])
  baseConfig = applyDefaultAgentModel(baseConfig)
  return injectSelfDelegationGuards(baseConfig)
}

function cloneProviderGatewayConfig(providerGatewayConfig: Record<string, unknown>): Record<string, unknown> {
  const provider = isRecord(providerGatewayConfig.provider)
    ? { ...providerGatewayConfig.provider }
    : undefined

  return provider ? { ...providerGatewayConfig, provider } : { ...providerGatewayConfig }
}

function removeRuntimeProvider(provider: Record<string, unknown>, providerId: ConfiguredOnlyRuntimeProviderId): void {
  delete provider[providerId]
}

function getOllamaRuntimeModels(secret: unknown): Record<string, { name: string }> | null {
  if (!isOllamaSecret(secret)) {
    return null
  }

  return Object.fromEntries(secret.models.map((model) => [model.id, { name: model.name }]))
}

async function applyOllamaRuntimeModels(
  provider: Record<string, unknown>,
  owner: NonNullable<WorkspaceOwner>,
): Promise<void> {
  if (!isRecord(provider.ollama)) {
    return
  }

  try {
    const credential = await getEffectiveCredentialForUser({
      providerId: 'ollama',
      userId: owner.id,
    })
    const models = credential ? getOllamaRuntimeModels(decryptProviderSecret(credential.credential.secret)) : null
    if (!models) {
      return
    }

    provider.ollama = {
      ...provider.ollama,
      models,
    }
  } catch {
    removeRuntimeProvider(provider, 'ollama')
  }
}

async function applyCredentialScopedProviderConfig(
  providerGatewayConfig: Record<string, unknown>,
  owner: WorkspaceOwner,
): Promise<Record<string, unknown>> {
  const nextConfig = cloneProviderGatewayConfig(providerGatewayConfig)
  if (!isRecord(nextConfig.provider)) {
    return nextConfig
  }

  if (!owner) {
    for (const providerId of CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS) {
      removeRuntimeProvider(nextConfig.provider, providerId)
    }
    return nextConfig
  }

  let enabledProviders: Awaited<ReturnType<typeof getEnabledProviderCredentialsForUser>>
  try {
    enabledProviders = await getEnabledProviderCredentialsForUser(owner.id)
  } catch {
    for (const providerId of CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS) {
      removeRuntimeProvider(nextConfig.provider, providerId)
    }
    return nextConfig
  }

  for (const providerId of CONFIGURED_ONLY_RUNTIME_PROVIDER_IDS) {
    if (!enabledProviders.has(providerId)) {
      removeRuntimeProvider(nextConfig.provider, providerId)
    }
  }

  if (enabledProviders.has('ollama')) {
    await applyOllamaRuntimeModels(nextConfig.provider, owner)
  }

  return nextConfig
}

export async function buildWorkspaceRuntimeConfig(
  slug: string,
  providerGatewayConfig: Record<string, unknown>,
  commonConfigContent?: string | null,
  owner?: WorkspaceOwner,
): Promise<Record<string, unknown>> {
  const baseConfig = await buildBaseWorkspaceConfig(slug, commonConfigContent)
  const resolvedOwner = typeof owner === 'undefined' ? await getWorkspaceOwner(slug) : owner
  const scopedProviderGatewayConfig = await applyCredentialScopedProviderConfig(providerGatewayConfig, resolvedOwner)
  return withWorkspacePermissionGuards({
    ...baseConfig,
    ...scopedProviderGatewayConfig,
  })
}

export async function buildWorkspaceAgentsMd(
  slug: string,
  owner?: WorkspaceOwner,
  agentsMdContent?: string | null
): Promise<string | undefined> {
  const agentsResult = typeof agentsMdContent === 'undefined'
    ? await readConfigRepoFile('AGENTS.md').catch(() => null)
    : agentsMdContent == null
      ? null
      : { ok: true as const, content: agentsMdContent }

  if (!agentsResult?.ok) {
    return undefined
  }

  const resolvedOwner = owner ?? (await getWorkspaceOwner(slug))
  const agentsMd = withWorkspaceIdentity(agentsResult.content, {
    slug: resolvedOwner?.slug ?? slug,
    email: resolvedOwner?.email,
  })
  return withLinkedRepositories(agentsMd, await getLinkedRepositoriesForOwner(resolvedOwner))
}

export async function buildWorkspaceRuntimeArtifacts(
  slug: string,
  providerGatewayConfig: Record<string, unknown>
): Promise<WorkspaceRuntimeArtifacts> {
  const owner = await getWorkspaceOwner(slug)
  const repoSnapshot = await readRuntimeRepoSnapshot()
  const config = await buildWorkspaceRuntimeConfig(
    slug,
    providerGatewayConfig,
    repoSnapshot.commonConfigContent,
    owner
  )
  const agentsMd = await buildWorkspaceAgentsMd(slug, owner, repoSnapshot.agentsMdContent)
  const skills = withSystemSkillBundles(repoSnapshot.skills)

  return {
    skills,
    owner,
    opencodeConfigContent: serializeRuntimeConfig(config),
    ...(agentsMd ? { agentsMd } : {}),
  }
}

export function hashWorkspaceRuntimeArtifacts(input: {
  skills?: SkillBundle[]
  opencodeConfigContent: string
  agentsMd?: string
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        opencodeConfigContent: normalizeRuntimeConfigForHash(input.opencodeConfigContent),
        agentsMd: input.agentsMd ?? null,
        skills: (input.skills ?? []).map((skill) => ({
          name: skill.skill.frontmatter.name,
          files: skill.files.map((file) => ({
            path: file.path,
            content: Buffer.from(file.content).toString('base64'),
          })),
        })),
      })
    )
    .digest('hex')
}
