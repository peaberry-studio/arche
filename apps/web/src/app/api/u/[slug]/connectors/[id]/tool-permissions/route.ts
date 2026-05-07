import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { requireConnectorCapability } from '@/lib/connectors/require-connector-capability'
import { loadConnectorToolInventory, type ConnectorToolInventoryItem } from '@/lib/connectors/tool-inventory'
import {
  getConnectorToolPermissionsForTools,
  getStoredConnectorToolPermissions,
  hasStoredConnectorToolPermissions,
  parseConnectorToolPermissions,
  setConnectorToolPermissions,
  toConnectorToolPermissionEntries,
  type ConnectorToolPermissionEntry,
} from '@/lib/connectors/tool-permissions'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorConfig, validateConnectorType } from '@/lib/connectors/validators'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

type ConnectorToolPermissionsResponse = {
  tools: ConnectorToolPermissionEntry[]
  policyConfigured: boolean
  inventoryError?: string
}

type UpdateConnectorToolPermissionsRequest = {
  permissions?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fallbackToolsFromStoredPermissions(
  config: Record<string, unknown>,
): ConnectorToolInventoryItem[] {
  const stored = getStoredConnectorToolPermissions(config)
  if (!stored) return []

  return Object.keys(stored).map((name) => ({
    name,
    title: name,
  }))
}

async function buildToolPermissionsResponse(input: {
  connectorType: ConnectorType
  config: Record<string, unknown>
}): Promise<ConnectorToolPermissionsResponse> {
  const inventory = await loadConnectorToolInventory({
    type: input.connectorType,
    config: input.config,
  })
  const tools = inventory.tools.length > 0
    ? inventory.tools
    : fallbackToolsFromStoredPermissions(input.config)
  const permissions = getConnectorToolPermissionsForTools(
    input.config,
    tools.map((tool) => tool.name),
  )

  return {
    tools: toConnectorToolPermissionEntries(tools, permissions),
    policyConfigured: hasStoredConnectorToolPermissions(input.config),
    ...(!inventory.ok ? { inventoryError: inventory.message } : {}),
  }
}

async function getConnectorContext(slug: string, id: string) {
  const targetUser = await userService.findIdBySlug(slug)
  if (!targetUser) {
    return { ok: false as const, response: NextResponse.json({ error: 'user_not_found' }, { status: 404 }) }
  }

  const connector = await connectorService.findByIdAndUserId(id, targetUser.id)
  if (!connector) {
    return { ok: false as const, response: NextResponse.json({ error: 'connector_not_found' }, { status: 404 }) }
  }

  if (!validateConnectorType(connector.type)) {
    return { ok: false as const, response: NextResponse.json({ error: 'unsupported_connector' }, { status: 400 }) }
  }
  const connectorType = connector.type

  const connectorDenied = requireConnectorCapability(connectorType)
  if (connectorDenied) {
    return { ok: false as const, response: connectorDenied }
  }

  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
        { status: 500 },
      ),
    }
  }

  const validation = validateConnectorConfig(connectorType, config)
  if (!validation.valid) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: 'invalid_config',
          message: validation.message ?? `Missing required fields: ${validation.missing?.join(', ')}`,
        },
        { status: 500 },
      ),
    }
  }

  return {
    ok: true as const,
    targetUserId: targetUser.id,
    connector,
    connectorType,
    config,
  }
}

export const GET = withAuth<
  ConnectorToolPermissionsResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: false }, async (_request: NextRequest, { slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const context = await getConnectorContext(slug, id)
  if (!context.ok) return context.response

  return NextResponse.json(
    await buildToolPermissionsResponse({
      connectorType: context.connectorType,
      config: context.config,
    }),
  )
})

export const PATCH = withAuth<
  ConnectorToolPermissionsResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: true }, async (request: NextRequest, { user, slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const context = await getConnectorContext(slug, id)
  if (!context.ok) return context.response

  let body: UpdateConnectorToolPermissionsRequest
  try {
    body = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    throw error
  }

  if (!isObjectRecord(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object' },
      { status: 400 },
    )
  }

  const inventory = await loadConnectorToolInventory({
    type: context.connectorType,
    config: context.config,
  })
  const tools = inventory.tools.length > 0
    ? inventory.tools
    : fallbackToolsFromStoredPermissions(context.config)
  const toolNames = tools.map((tool) => tool.name)

  if (toolNames.length === 0) {
    return NextResponse.json(
      {
        error: 'tools_unavailable',
        message: inventory.ok ? 'Connector has no tools.' : inventory.message,
      },
      { status: 409 },
    )
  }

  const parsedPermissions = parseConnectorToolPermissions(body.permissions, {
    allowedToolNames: toolNames,
  })
  if (!parsedPermissions.ok) {
    return NextResponse.json(
      { error: 'invalid_permissions', message: parsedPermissions.message },
      { status: 400 },
    )
  }

  const nextConfig = setConnectorToolPermissions(context.config, {
    ...getConnectorToolPermissionsForTools(context.config, toolNames),
    ...parsedPermissions.value,
  })

  let encryptedConfig: string
  try {
    encryptedConfig = encryptConfig(nextConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to encrypt config'
    return NextResponse.json({ error: 'invalid_config', message }, { status: 400 })
  }

  const result = await connectorService.updateManyByIdAndUserId(id, context.targetUserId, {
    config: encryptedConfig,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  await auditEvent({
    actorUserId: user.id,
    action: 'connector.tool_permissions_updated',
    metadata: {
      connectorId: id,
      toolCount: toolNames.length,
    },
  })

  return NextResponse.json(
    await buildToolPermissionsResponse({
      connectorType: context.connectorType,
      config: nextConfig,
    }),
  )
})
