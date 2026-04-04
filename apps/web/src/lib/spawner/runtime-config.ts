import { buildProviderGatewayConfig } from '@/lib/providers/catalog'
import { withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'

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
