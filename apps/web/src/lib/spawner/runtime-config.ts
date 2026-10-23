import { buildProviderGatewayConfig } from '@/lib/providers/catalog'
import { isRecord } from '@/lib/records'
import { withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'

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

// Address of this server's internal API as seen from workspace containers.
export const WEB_INTERNAL_API_ROOT = 'http://web:3000/api/internal'
// Session scratch folders in the workspace container: a size-capped tmpfs
// outside the Knowledge Base mount, wiped when the container restarts.
export const WEB_SCRATCH = { root: '/tmp/arche-scratch', workspaceRoot: '/workspace' } as const
export const WEB_XDG_DATA_HOME = '/home/workspace/.local/share'
// OpenCode spills oversized tool results here, under XDG_DATA_HOME.
export const WEB_TOOL_OUTPUT_DIRECTORY = `${WEB_XDG_DATA_HOME}/opencode/tool-output`

export function getWebProviderGatewayConfig(): Record<string, unknown> {
  return buildProviderGatewayConfig(`${WEB_INTERNAL_API_ROOT}/providers`)
}

export function getDefaultWebRuntimeConfigContent(): string {
  return serializeRuntimeConfig(withWorkspacePermissionGuards(getWebProviderGatewayConfig()))
}
