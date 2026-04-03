import { createHash } from 'node:crypto'

import { readCommonWorkspaceConfig, readConfigRepoFile } from '@/lib/common-workspace-config-store'
import { getConnectorGatewayBaseUrl } from '@/lib/connectors/gateway-config'
import { userService } from '@/lib/services'
import {
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
  owner: WorkspaceOwner
  opencodeConfigContent: string
  agentsMd?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

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

async function buildBaseWorkspaceConfig(slug: string): Promise<Record<string, unknown>> {
  let baseConfig: Record<string, unknown> = {}

  const commonConfigResult = await readCommonWorkspaceConfig().catch(() => null)
  if (commonConfigResult?.ok) {
    try {
      baseConfig = parseRuntimeConfigContent(commonConfigResult.content)
    } catch {
      console.warn('[workspace-runtime] Failed to parse CommonWorkspaceConfig')
    }
  }

  try {
    const mcpConfig = await buildMcpConfigForSlug(slug)
    if (mcpConfig?.mcp && Object.keys(mcpConfig.mcp).length > 0) {
      const userMcpKeys = new Set(Object.keys(mcpConfig.mcp))
      baseConfig = remapAgentConnectorTools(baseConfig, userMcpKeys)
      baseConfig = { ...baseConfig, mcp: mcpConfig.mcp }
    } else {
      baseConfig = remapAgentConnectorTools(baseConfig, new Set())
    }
  } catch {
    console.warn('[workspace-runtime] Failed to build MCP config')
    baseConfig = remapAgentConnectorTools(baseConfig, new Set())
  }

  baseConfig = injectAlwaysOnAgentTools(baseConfig)
  return injectSelfDelegationGuards(baseConfig)
}

export async function buildWorkspaceRuntimeConfig(
  slug: string,
  providerGatewayConfig: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const baseConfig = await buildBaseWorkspaceConfig(slug)
  return withWorkspacePermissionGuards({
    ...baseConfig,
    ...providerGatewayConfig,
  })
}

export async function buildWorkspaceAgentsMd(
  slug: string,
  owner?: WorkspaceOwner
): Promise<string | undefined> {
  const agentsResult = await readConfigRepoFile('AGENTS.md').catch(() => null)
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
  const config = await buildWorkspaceRuntimeConfig(slug, providerGatewayConfig)
  const agentsMd = await buildWorkspaceAgentsMd(slug, owner)

  return {
    owner,
    opencodeConfigContent: serializeRuntimeConfig(config),
    ...(agentsMd ? { agentsMd } : {}),
  }
}

export function hashWorkspaceRuntimeArtifacts(input: {
  opencodeConfigContent: string
  agentsMd?: string
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        opencodeConfigContent: normalizeRuntimeConfigForHash(input.opencodeConfigContent),
        agentsMd: input.agentsMd ?? null,
      })
    )
    .digest('hex')
}
