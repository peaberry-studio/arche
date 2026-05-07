import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { readConfigRepoSnapshot } from '@/lib/config-repo-store'
import { readCommonWorkspaceConfig, readConfigRepoFile } from '@/lib/common-workspace-config-store'
import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import { isRecord } from '@/lib/records'
import { readSkillBundlesFromRepoDir } from '@/lib/skills/skill-store'
import type { SkillBundle } from '@/lib/skills/types'
import { userService } from '@/lib/services'
import {
  applyDefaultAgentModel,
  injectAlwaysOnAgentTools,
  injectSelfDelegationGuards,
  remapAgentConnectorTools,
} from '@/lib/spawner/agent-config-transforms'
import { buildMcpConfigForSlug } from '@/lib/spawner/mcp-config'
import {
  withWorkspaceIdentity,
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
      )
      baseConfig = { ...baseConfig, mcp: mcpResult.mcpConfig.mcp }
    } else {
      baseConfig = remapAgentConnectorTools(baseConfig, new Set())
    }
  } catch {
    console.warn('[workspace-runtime] Failed to build MCP config')
    baseConfig = remapAgentConnectorTools(baseConfig, new Set())
  }

  baseConfig = injectAlwaysOnAgentTools(baseConfig)
  baseConfig = applyDefaultAgentModel(baseConfig)
  return injectSelfDelegationGuards(baseConfig)
}

export async function buildWorkspaceRuntimeConfig(
  slug: string,
  providerGatewayConfig: Record<string, unknown>,
  commonConfigContent?: string | null
): Promise<Record<string, unknown>> {
  const baseConfig = await buildBaseWorkspaceConfig(slug, commonConfigContent)
  return withWorkspacePermissionGuards({
    ...baseConfig,
    ...providerGatewayConfig,
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
  return withWorkspaceIdentity(agentsResult.content, {
    slug: resolvedOwner?.slug ?? slug,
    email: resolvedOwner?.email,
  })
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
    repoSnapshot.commonConfigContent
  )
  const agentsMd = await buildWorkspaceAgentsMd(slug, owner, repoSnapshot.agentsMdContent)

  return {
    skills: repoSnapshot.skills,
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
