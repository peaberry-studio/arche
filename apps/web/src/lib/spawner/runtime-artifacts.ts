import { createHash } from 'node:crypto'

import { readCommonWorkspaceConfig, readConfigRepoFile } from '@/lib/common-workspace-config-store'
import { buildProviderGatewayConfig } from '@/lib/providers/catalog'
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

export function parseRuntimeConfigContent(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed)) {
    throw new Error('Invalid opencode config: expected a JSON object')
  }

  return parsed
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry))
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  )
}

export function serializeRuntimeConfig(config: Record<string, unknown>): string {
  return JSON.stringify(sortJsonValue(config))
}

export function getWebProviderGatewayConfig(): Record<string, unknown> {
  return buildProviderGatewayConfig('http://web:3000/api/internal/providers')
}

export function getDefaultWebRuntimeConfigContent(): string {
  return serializeRuntimeConfig(withWorkspacePermissionGuards(getWebProviderGatewayConfig()))
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
        opencodeConfigContent: input.opencodeConfigContent,
        agentsMd: input.agentsMd ?? null,
      })
    )
    .digest('hex')
}
