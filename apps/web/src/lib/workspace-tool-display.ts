import type { ConnectorType } from '@/lib/connectors/types'

const CONNECTOR_TYPE_LABELS: Record<ConnectorType, string> = {
  linear: 'Linear',
  notion: 'Notion',
  custom: 'Custom Connector',
}

const CONNECTOR_TOOL_NAME_PATTERN = /^arche_(linear|notion|custom)_([^_]+)_(.+)$/

export type WorkspaceToolDisplay = {
  isConnectorTool: boolean
  groupLabel: string
  commandLabel?: string
}

export function parseConnectorToolName(toolName: string): {
  connectorType: ConnectorType
  connectorId: string
  commandName: string
} | null {
  const match = toolName.match(CONNECTOR_TOOL_NAME_PATTERN)
  if (!match) return null

  const [, connectorType, connectorId, commandName] = match
  return {
    connectorType,
    connectorId,
    commandName,
  }
}

export function formatConnectorCommandName(commandName: string): string {
  return commandName
    .replace(/[_-]+/g, ' ')
    .trim()
}

export function getWorkspaceToolDisplay(
  toolName: string,
  connectorNamesById?: Record<string, string>
): WorkspaceToolDisplay {
  const parsed = parseConnectorToolName(toolName)
  if (!parsed) {
    return {
      isConnectorTool: false,
      groupLabel: toolName,
    }
  }

  const connectorLabel = connectorNamesById?.[parsed.connectorId]?.trim() || CONNECTOR_TYPE_LABELS[parsed.connectorType]
  const commandLabel = formatConnectorCommandName(parsed.commandName)

  return {
    isConnectorTool: true,
    groupLabel: `Using ${connectorLabel}`,
    commandLabel: commandLabel || undefined,
  }
}
