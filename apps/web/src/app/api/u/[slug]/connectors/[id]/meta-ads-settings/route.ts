import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import {
  clearConnectorOAuthConfig,
  getConnectorAuthType,
  getConnectorOAuthConfig,
} from '@/lib/connectors/oauth-config'
import {
  listMetaAdAccounts,
  parseMetaAdsConnectorConfig,
  parseMetaAdsConnectorPermissions,
  parseMetaAdsSelectedAdAccountIds,
  normalizeMetaAdsAccountId,
} from '@/lib/connectors/meta-ads'
import type {
  MetaAdsAdAccount,
  MetaAdsConnectorPermissions,
} from '@/lib/connectors/meta-ads-types'
import { getPublicBaseUrl } from '@/lib/http'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { connectorService, userService } from '@/lib/services'

type MetaAdsConnectorSettingsResponse = {
  appId: string
  hasAppSecret: boolean
  permissions: MetaAdsConnectorPermissions
  oauthConnected: boolean
  oauthExpiresAt?: string
  selectedAdAccountIds: string[]
  defaultAdAccountId?: string
  adAccounts: MetaAdsAdAccount[]
  adAccountsError?: string
  redirectUri: string
}

type UpdateMetaAdsConnectorSettingsRequest = {
  appId?: unknown
  appSecret?: unknown
  permissions?: unknown
  selectedAdAccountIds?: unknown
  defaultAdAccountId?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function buildSettingsResponse(
  request: NextRequest,
  connectorConfig: Record<string, unknown>
): Promise<MetaAdsConnectorSettingsResponse | { error: string; message?: string }> {
  const parsedConfig = parseMetaAdsConnectorConfig(connectorConfig)
  if (!parsedConfig.ok) {
    return {
      error: 'invalid_config',
      message: parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`,
    }
  }

  const oauth = getConnectorOAuthConfig('meta-ads', connectorConfig)
  const origin = request.nextUrl?.origin ?? new URL(request.url).origin
  const baseUrl = getPublicBaseUrl(request.headers, origin)

  let adAccounts: MetaAdsAdAccount[] = []
  let adAccountsError: string | undefined
  if (oauth?.accessToken) {
    const adAccountsResponse = await listMetaAdAccounts(connectorConfig)
    if (adAccountsResponse.ok) {
      adAccounts = adAccountsResponse.data.items
    } else {
      adAccountsError = adAccountsResponse.message
    }
  }

  return {
    appId: parsedConfig.value.appId,
    hasAppSecret: true,
    permissions: parsedConfig.value.permissions,
    oauthConnected: Boolean(oauth?.accessToken),
    oauthExpiresAt: oauth?.expiresAt,
    selectedAdAccountIds: parsedConfig.value.selectedAdAccountIds,
    defaultAdAccountId: parsedConfig.value.defaultAdAccountId,
    adAccounts,
    adAccountsError,
    redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
  }
}

export const GET = withAuth<
  MetaAdsConnectorSettingsResponse | { error: string; message?: string },
  { slug: string; id: string }
>({ csrf: false }, async (request: NextRequest, { slug, params: { id } }) => {
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

  if (connector.type !== 'meta-ads') {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  const metaDenied = requireCapability('metaAdsConnector')
  if (metaDenied) return metaDenied

  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  const response = await buildSettingsResponse(request, config)
  if ('error' in response) {
    return NextResponse.json(response, { status: 500 })
  }

  return NextResponse.json(response)
})

export const PATCH = withAuth<
  MetaAdsConnectorSettingsResponse | { error: string; message?: string },
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

  if (connector.type !== 'meta-ads') {
    return NextResponse.json({ error: 'unsupported_connector' }, { status: 400 })
  }

  const patchDenied = requireCapability('metaAdsConnector')
  if (patchDenied) return patchDenied

  let body: UpdateMetaAdsConnectorSettingsRequest
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

  let config: Record<string, unknown>
  try {
    config = decryptConfig(connector.config)
  } catch {
    return NextResponse.json(
      { error: 'config_corrupted', message: 'Failed to decrypt connector configuration' },
      { status: 500 }
    )
  }

  const parsedConfig = parseMetaAdsConnectorConfig(config)
  if (!parsedConfig.ok) {
    return NextResponse.json(
      {
        error: 'invalid_config',
        message: parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`,
      },
      { status: 500 }
    )
  }

  const appId = body.appId === undefined
    ? parsedConfig.value.appId
    : typeof body.appId === 'string' && body.appId.trim()
      ? body.appId.trim()
      : null
  if (!appId) {
    return NextResponse.json(
      { error: 'invalid_app_id', message: 'App ID is required.' },
      { status: 400 }
    )
  }

  let appSecret = parsedConfig.value.appSecret
  if (body.appSecret !== undefined) {
    if (typeof body.appSecret !== 'string') {
      return NextResponse.json(
        { error: 'invalid_app_secret', message: 'App Secret must be a string.' },
        { status: 400 }
      )
    }

    if (body.appSecret.trim()) {
      appSecret = body.appSecret.trim()
    }
  }

  const permissions = body.permissions === undefined
    ? { ok: true as const, value: parsedConfig.value.permissions }
    : parseMetaAdsConnectorPermissions(body.permissions, { requireAll: true })
  if (!permissions.ok) {
    return NextResponse.json(
      { error: 'invalid_permissions', message: permissions.message },
      { status: 400 }
    )
  }

  const selectedAdAccountIds = body.selectedAdAccountIds === undefined
    ? { ok: true as const, value: parsedConfig.value.selectedAdAccountIds }
    : parseMetaAdsSelectedAdAccountIds(body.selectedAdAccountIds)
  if (!selectedAdAccountIds.ok) {
    return NextResponse.json(
      { error: 'invalid_ad_accounts', message: selectedAdAccountIds.message },
      { status: 400 }
    )
  }

  let defaultAdAccountId = parsedConfig.value.defaultAdAccountId
  if (body.defaultAdAccountId !== undefined) {
    if (body.defaultAdAccountId === null) {
      defaultAdAccountId = undefined
    } else if (typeof body.defaultAdAccountId !== 'string') {
      return NextResponse.json(
        { error: 'invalid_default_ad_account', message: 'Default ad account must be a string or null.' },
        { status: 400 }
      )
    } else {
      const normalizedDefaultAdAccountId = normalizeMetaAdsAccountId(body.defaultAdAccountId)
      if (!normalizedDefaultAdAccountId) {
        return NextResponse.json(
          { error: 'invalid_default_ad_account', message: 'Default ad account must be a valid Meta ad account id.' },
          { status: 400 }
        )
      }

      defaultAdAccountId = normalizedDefaultAdAccountId
    }
  }

  if (defaultAdAccountId && !selectedAdAccountIds.value.includes(defaultAdAccountId)) {
    return NextResponse.json(
      {
        error: 'invalid_default_ad_account',
        message: 'Default ad account must match one of the selected ad accounts.',
      },
      { status: 400 }
    )
  }

  const credentialsChanged = appId !== parsedConfig.value.appId || appSecret !== parsedConfig.value.appSecret
  const nextConfig = credentialsChanged
    ? {
        ...clearConnectorOAuthConfig(config),
        appId,
        appSecret,
        permissions: permissions.value,
        selectedAdAccountIds: [],
        defaultAdAccountId: undefined,
      }
    : {
        ...config,
        authType: getConnectorAuthType(config),
        appId,
        appSecret,
        permissions: permissions.value,
        selectedAdAccountIds: selectedAdAccountIds.value,
        defaultAdAccountId,
      }

  let encryptedConfig: string
  try {
    encryptedConfig = encryptConfig(nextConfig)
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
    action: 'connector.meta_ads_settings_updated',
    metadata: {
      connectorId: id,
      credentialsChanged,
      allowRead: permissions.value.allowRead,
      selectedAdAccountCount: credentialsChanged ? 0 : selectedAdAccountIds.value.length,
    },
  })

  const response = await buildSettingsResponse(request, nextConfig)
  if ('error' in response) {
    return NextResponse.json(response, { status: 500 })
  }

  return NextResponse.json(response)
})
