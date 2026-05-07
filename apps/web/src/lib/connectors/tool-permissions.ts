import { isRecord } from '@/lib/records'

export const CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY = 'mcpToolPermissions'

export const CONNECTOR_TOOL_PERMISSION_ACTIONS = ['deny', 'ask', 'allow'] as const

export type ConnectorToolPermission = (typeof CONNECTOR_TOOL_PERMISSION_ACTIONS)[number]
export type ConnectorToolPermissionMap = Record<string, ConnectorToolPermission>

export type ConnectorToolPermissionEntry = {
  name: string
  title: string
  description?: string
  permission: ConnectorToolPermission
}

export type ParsedConnectorToolPermissions =
  | { ok: true; value: ConnectorToolPermissionMap }
  | { ok: false; message: string }

export function isConnectorToolPermission(value: unknown): value is ConnectorToolPermission {
  return CONNECTOR_TOOL_PERMISSION_ACTIONS.includes(value as ConnectorToolPermission)
}

function normalizeToolName(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseConnectorToolPermissions(
  value: unknown,
  options?: { allowedToolNames?: readonly string[] },
): ParsedConnectorToolPermissions {
  if (!isRecord(value)) {
    return { ok: false, message: 'permissions must be an object' }
  }

  const allowedToolNames = options?.allowedToolNames
    ? new Set(options.allowedToolNames)
    : null
  const permissions: ConnectorToolPermissionMap = {}

  for (const [rawName, rawPermission] of Object.entries(value)) {
    const name = normalizeToolName(rawName)
    if (!name) {
      return { ok: false, message: 'tool names must be non-empty strings' }
    }

    if (allowedToolNames && !allowedToolNames.has(name)) {
      return { ok: false, message: `Unknown connector tool: ${name}` }
    }

    if (!isConnectorToolPermission(rawPermission)) {
      return { ok: false, message: `${name} must be deny, ask or allow` }
    }

    permissions[name] = rawPermission
  }

  return { ok: true, value: permissions }
}

export function getStoredConnectorToolPermissions(
  config: Record<string, unknown>,
): ConnectorToolPermissionMap | null {
  if (!(CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY in config)) {
    return null
  }

  const parsed = parseConnectorToolPermissions(config[CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY])
  return parsed.ok ? parsed.value : null
}

export function hasStoredConnectorToolPermissions(config: Record<string, unknown>): boolean {
  return getStoredConnectorToolPermissions(config) !== null
}

export function getConnectorToolPermissionsForTools(
  config: Record<string, unknown>,
  toolNames: readonly string[],
): ConnectorToolPermissionMap {
  const stored = getStoredConnectorToolPermissions(config) ?? {}
  return Object.fromEntries(
    toolNames.map((name) => [name, stored[name] ?? 'allow'] as const),
  )
}

export function setConnectorToolPermissions(
  config: Record<string, unknown>,
  permissions: ConnectorToolPermissionMap,
): Record<string, unknown> {
  return {
    ...config,
    [CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY]: permissions,
  }
}

export function preserveConnectorToolPermissions(
  currentConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (
    nextConfig[CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY] !== undefined ||
    currentConfig[CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY] === undefined
  ) {
    return nextConfig
  }

  return {
    ...nextConfig,
    [CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY]: currentConfig[CONNECTOR_TOOL_PERMISSIONS_CONFIG_KEY],
  }
}

export function toConnectorToolPermissionEntries(
  tools: Array<{ name: string; title?: string; description?: string }>,
  permissions: ConnectorToolPermissionMap,
): ConnectorToolPermissionEntry[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description,
    permission: permissions[tool.name] ?? 'allow',
  }))
}
