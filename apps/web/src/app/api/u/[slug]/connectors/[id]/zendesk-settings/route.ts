import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import {
  getZendeskConnectorPermissionsConstraintMessage,
  parseZendeskConnectorConfig,
  parseZendeskConnectorPermissions,
  type ZendeskConnectorPermissions,
} from '@/lib/connectors/zendesk'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

type ZendeskConnectorSettingsResponse = {
  permissions: ZendeskConnectorPermissions
}

type UpdateZendeskConnectorSettingsRequest = {
  permissions?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const GET = withAuth<
  ZendeskConnectorSettingsResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: false }, async (_request: NextRequest, { slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const targetUser = await userService.findIdBySlug(slug)
  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  const connector = await connectorService.findByIdAndUserId(id, targetUser.id)
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  if (connector.type !== 'zendesk') {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  const parsedConfig = parseZendeskConnectorConfig(config)
  if (!parsedConfig.ok) {
    return NextResponse.json(
      {
        error: 'invalid_config',
        message: parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ permissions: parsedConfig.value.permissions })
})

export const PATCH = withAuth<
  ZendeskConnectorSettingsResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: true }, async (request: NextRequest, { user, slug, params: { id } }) => {
  const denied = requireCapability('connectors')
  if (denied) return denied

  const targetUser = await userService.findIdBySlug(slug)
  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  const connector = await connectorService.findByIdAndUserId(id, targetUser.id)
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  if (connector.type !== 'zendesk') {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  let body: UpdateZendeskConnectorSettingsRequest
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
      { status: 400 }
    )
  }

  const parsedPermissions = parseZendeskConnectorPermissions(body.permissions, { requireAll: true })
  if (!parsedPermissions.ok) {
    return NextResponse.json(
      { error: 'invalid_permissions', message: parsedPermissions.message },
      { status: 400 }
    )
  }

  const permissionsMessage = getZendeskConnectorPermissionsConstraintMessage(
    parsedPermissions.value
  )
  if (permissionsMessage) {
    return NextResponse.json(
      { error: 'invalid_permissions', message: permissionsMessage },
      { status: 400 }
    )
  }

  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  const parsedConfig = parseZendeskConnectorConfig(config)
  if (!parsedConfig.ok) {
    return NextResponse.json(
      {
        error: 'invalid_config',
        message: parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`,
      },
      { status: 500 }
    )
  }

  const updatedConfig = {
    ...config,
    ...parsedConfig.value,
    permissions: parsedPermissions.value,
  }

  let encryptedConfig: string
  try {
    encryptedConfig = encryptConfig(updatedConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to encrypt config'
    return NextResponse.json({ error: 'invalid_config', message }, { status: 400 })
  }

  const result = await connectorService.updateManyByIdAndUserId(id, targetUser.id, {
    config: encryptedConfig,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  await auditEvent({
    actorUserId: user.id,
    action: 'connector.zendesk_settings_updated',
    metadata: {
      connectorId: id,
      permissions: parsedPermissions.value,
    },
  })

  return NextResponse.json({ permissions: parsedPermissions.value })
})
