const CONNECTOR_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your session has expired. Please sign in again.',
  forbidden: 'You are not allowed to perform this action.',
  user_not_found: 'Workspace user was not found.',
  connector_not_found: 'Connector was not found.',
  unsupported_connector: 'This action is not supported for the selected connector.',
  connector_already_exists: 'This connector is already configured.',
  invalid_state: 'OAuth session is invalid. Please retry connecting.',
  expired_state: 'OAuth session expired. Please retry connecting.',
  missing_state: 'OAuth response is missing required state.',
  missing_code: 'OAuth response is missing authorization code.',
  access_denied: 'Authorization was denied by the provider.',
  oauth_error: 'OAuth authentication failed.',
  oauth_start_failed: 'Unable to start OAuth authentication.',
  oauth_discovery_failed: 'Unable to discover OAuth metadata for this MCP server.',
  oauth_registration_failed: 'Dynamic client registration failed for this MCP server.',
  oauth_exchange_failed: 'OAuth token exchange failed. Please retry.',
  oauth_refresh_failed: 'OAuth token refresh failed. Please reconnect.',
  oauth_state_too_large: 'OAuth request is too large. Use shorter URLs or fewer optional overrides.',
  missing_endpoint: 'Connector endpoint is required.',
  invalid_endpoint: 'Connector endpoint must be a valid public HTTPS URL.',
  blocked_endpoint: 'Connector endpoint is blocked for security reasons.',
  meta_ads_missing_app_id: 'Meta Ads App ID is required before starting OAuth.',
  meta_ads_missing_app_secret: 'Meta Ads App Secret is required before starting OAuth.',
  load_failed: 'Failed to load connectors.',
  load_settings_failed: 'Failed to load connector settings.',
  save_failed: 'Failed to save connector changes.',
  invalid_permissions: 'The selected connector settings are invalid.',
  invalid_ad_accounts: 'The selected Meta ad accounts are invalid.',
  invalid_app_id: 'Meta Ads App ID is invalid.',
  invalid_app_secret: 'Meta Ads App Secret is invalid.',
  invalid_default_ad_account: 'The selected default Meta ad account is invalid.',
  create_failed: 'Failed to create connector.',
  update_failed: 'Failed to update connector.',
  delete_failed: 'Failed to delete connector.',
  test_failed: 'Connection test failed.',
  network_error: 'Network error. Please try again.',
}

function humanizeCode(code: string): string {
  if (!/^[a-z0-9_]+$/.test(code)) return code
  const phrase = code.replace(/_/g, ' ')
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

export function formatConnectorErrorCode(raw: string, fallback: string): string {
  const source = raw.trim() || fallback
  if (!source) return 'Request failed.'

  const base = source.split(':')[0] ?? source
  if (base in CONNECTOR_ERROR_MESSAGES) {
    return CONNECTOR_ERROR_MESSAGES[base] ?? source
  }

  if (source === fallback && fallback in CONNECTOR_ERROR_MESSAGES) {
    return CONNECTOR_ERROR_MESSAGES[fallback] ?? source
  }

  return humanizeCode(source)
}

export function getConnectorErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') {
    return formatConnectorErrorCode(fallback, fallback)
  }

  const payload = value as { message?: unknown; error?: unknown }
  const raw =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : fallback

  return formatConnectorErrorCode(raw, fallback)
}
