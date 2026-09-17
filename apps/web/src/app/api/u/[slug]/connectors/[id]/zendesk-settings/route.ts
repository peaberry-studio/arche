import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import {
  getStoredConnectorToolPermissions,
} from '@/lib/connectors/tool-permissions'
import {
  buildLegacyProjectionFromActionPermissions,
  mergeLegacyToolPermissions,
  normalizeZendeskActionPermissions,
  parseZendeskActionPermissionsConfig,
  parseZendeskConnectorConfig,
  parseZendeskConnectorPermissions,
  type ZendeskActionPermissions,
} from '@/lib/connectors/zendesk'
import {
  ZENDESK_ACTION_PERMISSIONS_CONFIG_KEY,
  ZENDESK_ACTION_PERMISSIONS_VERSION,
} from '@/lib/connectors/zendesk-types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

type ZendeskActionPermissionsPayload = {
  version: typeof ZENDESK_ACTION_PERMISSIONS_VERSION
  actions: ZendeskActionPermissions
}

type ZendeskConnectorSettingsResponse = {
  permissions: Record<string, unknown>
  zendeskActionPermissions: ZendeskActionPermissionsPayload
}

type UpdateZendeskConnectorSettingsRequest = {
  permissions?: unknown
  zendeskActionPermissions?: unknown
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

  return NextResponse.json({
    permissions: parsedConfig.value.permissions,
    zendeskActionPermissions: {
      version: ZENDESK_ACTION_PERMISSIONS_VERSION,
      actions: normalizeZendeskActionPermissions(config),
    },
  })
})

function buildUpdatedConfig(input: {
  config: Record<string, unknown>
  parsedConfig: Extract<ReturnType<typeof parseZendeskConnectorConfig>, { ok: true }>['value']
  actions: ZendeskActionPermissions
}): {
  config: Record<string, unknown>
  permissions: Record<string, unknown>
} {
  const projection = buildLegacyProjectionFromActionPermissions(input.actions)

  return {
    config: {
      ...input.config,
      ...input.parsedConfig,
      permissions: projection.permissions,
      mcpToolPermissions: mergeLegacyToolPermissions(
        getStoredConnectorToolPermissions(input.config),
        projection.legacyToolPermissions
      ),
      [ZENDESK_ACTION_PERMISSIONS_CONFIG_KEY]: {
        version: ZENDESK_ACTION_PERMISSIONS_VERSION,
        actions: input.actions,
      },
    },
    permissions: projection.permissions,
  }
}

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

  let update:
    | { kind: 'canonical'; actions: ZendeskActionPermissions }
    | { kind: 'legacy'; permissions: Record<string, unknown> }
  if (body.zendeskActionPermissions !== undefined) {
    const parsedActions = parseZendeskActionPermissionsConfig(body.zendeskActionPermissions)
    if (!parsedActions.ok) {
      return NextResponse.json(
        { error: 'invalid_permissions', message: parsedActions.message },
        { status: 400 }
      )
    }
    update = { kind: 'canonical', actions: parsedActions.value.actions }
  } else if (body.permissions !== undefined) {
    const parsedPermissions = parseZendeskConnectorPermissions(body.permissions, { requireAll: true })
    if (!parsedPermissions.ok) {
      return NextResponse.json(
        { error: 'invalid_permissions', message: parsedPermissions.message },
        { status: 400 }
      )
    }
    update = { kind: 'legacy', permissions: parsedPermissions.value }
  } else {
    return NextResponse.json(
      { error: 'invalid_permissions', message: 'permissions or zendeskActionPermissions is required' },
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

  // A legacy boolean request is normalized into canonical actions before it is
  // persisted, so both request shapes converge on the same stored state.
  const actions = update.kind === 'canonical'
    ? update.actions
    : normalizeZendeskActionPermissions({
        ...config,
        permissions: update.permissions,
      })

  const updated = buildUpdatedConfig({ config, parsedConfig: parsedConfig.value, actions })

  let encryptedConfig: string
  try {
    encryptedConfig = encryptConfig(updated.config)
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
      permissions: updated.permissions,
      zendeskActionPermissions: {
        version: ZENDESK_ACTION_PERMISSIONS_VERSION,
        actions,
      },
    },
  })

  return NextResponse.json({
    permissions: updated.permissions,
    zendeskActionPermissions: {
      version: ZENDESK_ACTION_PERMISSIONS_VERSION,
      actions,
    },
  })
})
