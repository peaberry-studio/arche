import { normalizeZendeskSubdomain } from '@/lib/connectors/zendesk-shared'

import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type ZendeskConnectorFormState = {
  selectedType: 'zendesk'
  zendeskSubdomain: string
  zendeskEmail: string
  apiToken: string
}

export function buildZendeskConnectorConfig(
  state: ZendeskConnectorFormState
): ConnectorConfigResult {
  if (!state.zendeskSubdomain.trim()) {
    return { ok: false, message: 'Zendesk subdomain is required.' }
  }

  if (!state.zendeskEmail.trim()) {
    return { ok: false, message: 'Zendesk agent email is required.' }
  }

  if (!state.apiToken.trim()) {
    return { ok: false, message: 'Zendesk API token is required.' }
  }

  return {
    ok: true,
    value: {
      subdomain: normalizeZendeskSubdomain(state.zendeskSubdomain),
      email: state.zendeskEmail.trim(),
      apiToken: state.apiToken.trim(),
    },
  }
}

export function isZendeskConnectorConfigurationComplete(
  state: ZendeskConnectorFormState
): boolean {
  return Boolean(
    state.zendeskSubdomain.trim() && state.zendeskEmail.trim() && state.apiToken.trim()
  )
}
