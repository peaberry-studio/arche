import {
  readCommonWorkspaceConfig,
  writeCommonWorkspaceConfig,
} from '@/lib/common-workspace-config-store'
import {
  parseCommonWorkspaceConfig,
  type CommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

type ReadConfigError = 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed'
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
  | { ok: false; enabled: false; error: ReadConfigError }
> {
  const configResult = await readValidatedConfig()
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
  const configResult = await readValidatedConfig()
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

async function readValidatedConfig(): Promise<
  | { ok: true; config: CommonWorkspaceConfig; hash: string }
  | { ok: false; error: ReadConfigError }
> {
  const configResult = await readCommonWorkspaceConfig()
  if (!configResult.ok) {
    return { ok: false, error: configResult.error }
  }

  const parsed = parseCommonWorkspaceConfig(configResult.content)
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  return {
    ok: true,
    config: parsed.config,
    hash: configResult.hash,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mapReadErrorToWriteError(error: ReadConfigError): WriteConfigError {
  switch (error) {
    case 'read_failed':
      return 'write_failed'
    default:
      return error
  }
}
