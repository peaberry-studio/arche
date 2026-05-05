import { writeCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import {
  readValidatedWorkspaceConfig,
  type WorkspaceConfigError,
} from '@/lib/mcp/validated-config'
import type { CommonWorkspaceConfig } from '@/lib/workspace-config'

type WriteConfigError = 'conflict' | 'invalid_config' | 'kb_unavailable' | 'not_found' | 'write_failed'

export function getMcpEnabledFromConfig(config: CommonWorkspaceConfig): boolean {
  return config.mcp?.enabled === true
}

export function setMcpEnabledInConfig(
  config: CommonWorkspaceConfig,
  enabled: boolean
): CommonWorkspaceConfig {
  return {
    ...config,
    mcp: {
      ...(isRecord(config.mcp) ? config.mcp : {}),
      enabled,
    },
  }
}

export async function readMcpSettings(): Promise<
  | { ok: true; enabled: boolean; hash: string }
  | { ok: false; enabled: false; error: WorkspaceConfigError }
> {
  const configResult = await readValidatedWorkspaceConfig()
  if (!configResult.ok) {
    return {
      ok: false,
      enabled: false,
      error: configResult.error,
    }
  }

  return {
    ok: true,
    enabled: getMcpEnabledFromConfig(configResult.config),
    hash: configResult.hash,
  }
}

export async function writeMcpSettings(
  enabled: boolean,
  expectedHash?: string
): Promise<
  | { ok: true; enabled: boolean; hash: string }
  | { ok: false; error: WriteConfigError }
> {
  const configResult = await readValidatedWorkspaceConfig()
  if (!configResult.ok) {
    return { ok: false, error: mapReadErrorToWriteError(configResult.error) }
  }

  const nextConfig = setMcpEnabledInConfig(configResult.config, enabled)
  const writeResult = await writeCommonWorkspaceConfig(
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    expectedHash
  )

  if (!writeResult.ok) {
    return { ok: false, error: writeResult.error }
  }

  return {
    ok: true,
    enabled,
    hash: writeResult.hash,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function formatMcpConfigError(error: string): string {
  switch (error) {
    case 'conflict':
      return 'MCP settings changed elsewhere. Please retry.'
    case 'not_found':
      return 'Knowledge base configuration is not initialized yet.'
    case 'kb_unavailable':
      return 'Knowledge base configuration is unavailable.'
    case 'invalid_config':
      return 'Knowledge base configuration is invalid.'
    default:
      return 'Failed to load MCP settings.'
  }
}

function mapReadErrorToWriteError(error: WorkspaceConfigError): WriteConfigError {
  switch (error) {
    case 'read_failed':
      return 'write_failed'
    default:
      return error
  }
}
