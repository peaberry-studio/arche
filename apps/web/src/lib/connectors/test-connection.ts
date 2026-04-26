import { parseAhrefsConnectorConfig, testAhrefsConnection } from '@/lib/connectors/ahrefs'
import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'
import { testMetaAdsConnection } from '@/lib/connectors/meta-ads'
import { getConnectorAuthType, getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { parseUmamiConnectorConfig, testUmamiConnection } from '@/lib/connectors/umami'
import { getZendeskMcpProtocolVersion, parseZendeskConnectorConfig, testZendeskConnection } from '@/lib/connectors/zendesk'
import type { ConnectorType } from '@/lib/connectors/types'

export type TestConnectionResult = {
  ok: boolean
  tested: boolean
  message?: string
}

type TestConnectionOptions = {
  customEndpointUrl?: URL
}

type TestConnectionHandler = (
  config: Record<string, unknown>,
  options: TestConnectionOptions
) => Promise<TestConnectionResult>

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

function getAccessToken(type: ConnectorType, config: Record<string, unknown>): string | null {
  if (getConnectorAuthType(config) === 'oauth') {
    const oauth = getConnectorOAuthConfig(type, config)
    return oauth?.accessToken ?? null
  }

  switch (type) {
    case 'linear':
    case 'notion':
      return typeof config.apiKey === 'string' ? config.apiKey : null
    case 'zendesk':
    case 'meta-ads':
    case 'ahrefs':
    case 'umami':
    case 'custom':
      return null
    case 'google_gmail':
    case 'google_drive':
    case 'google_calendar':
    case 'google_chat':
    case 'google_people':
      return null
    default: {
      const _exhaustive: never = type
      throw new Error(`Unhandled connector type: ${_exhaustive}`)
    }
  }
}

function isOAuthPending(type: ConnectorType, config: Record<string, unknown>): boolean {
  if (getConnectorAuthType(config) !== 'oauth') return false
  return !getConnectorOAuthConfig(type, config)?.accessToken
}

function buildMcpInitializeBody() {
  return {
    jsonrpc: '2.0',
    id: 'arche-connector-test',
    method: 'initialize',
    params: {
      protocolVersion: getZendeskMcpProtocolVersion(),
      clientInfo: {
        name: 'arche-web',
        version: '0.1.0',
      },
      capabilities: {},
    },
  }
}

function getPendingOAuthMessage(type: ConnectorType, config: Record<string, unknown>): TestConnectionResult | null {
  if (!isOAuthPending(type, config)) return null
  return {
    ok: false,
    tested: false,
    message: 'Complete OAuth from the dashboard before testing this connector.',
  }
}

function getRequiredAccessToken(
  type: ConnectorType,
  config: Record<string, unknown>,
  missingMessage: string
): { ok: true; token: string } | { ok: false; result: TestConnectionResult } {
  const token = getAccessToken(type, config)
  if (!token) {
    return {
      ok: false,
      result: { ok: false, tested: false, message: missingMessage },
    }
  }

  return { ok: true, token }
}

async function testRemoteMcpConnection(input: {
  label: string
  url: string
  token: string
}): Promise<TestConnectionResult> {
  const response = await fetchWithTimeout(input.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(buildMcpInitializeBody()),
  })

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      tested: true,
      message: `${input.label} MCP authentication failed (${response.status}). Reconnect OAuth and retry.`,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      tested: true,
      message: `${input.label} MCP test failed (${response.status})`,
    }
  }

  return {
    ok: true,
    tested: true,
    message: `${input.label} MCP connection verified.`,
  }
}

type EmbeddedConnectorTestConnection<TConfig> = (config: TConfig) => Promise<{ ok: boolean; message?: string }>

function buildEmbeddedConnectorTestHandler<TConfig>(
  label: string,
  parseConfig: (config: Record<string, unknown>) => { ok: true; value: TConfig } | { ok: false; missing?: string[]; message?: string },
  testConnection: EmbeddedConnectorTestConnection<TConfig>
): TestConnectionHandler {
  return async (config) => {
    const parsed = parseConfig(config)
    if (!parsed.ok) {
      return {
        ok: false,
        tested: false,
        message: parsed.message ?? `Missing required fields: ${parsed.missing?.join(', ')}`,
      }
    }

    const response = await testConnection(parsed.value)
    if (!response.ok) {
      return {
        ok: false,
        tested: true,
        message: response.message,
      }
    }

    return { ok: true, tested: true, message: `${label} connection verified.` }
  }
}

const CONNECTOR_TEST_HANDLERS: Record<ConnectorType, TestConnectionHandler> = {
  ahrefs: buildEmbeddedConnectorTestHandler(
    'Ahrefs',
    parseAhrefsConnectorConfig,
    testAhrefsConnection
  ),

  zendesk: buildEmbeddedConnectorTestHandler(
    'Zendesk',
    parseZendeskConnectorConfig,
    testZendeskConnection
  ),

  umami: buildEmbeddedConnectorTestHandler(
    'Umami',
    parseUmamiConnectorConfig,
    testUmamiConnection
  ),

  'meta-ads': async (config) => {
    const pending = getPendingOAuthMessage('meta-ads', config)
    if (pending) return pending

    const response = await testMetaAdsConnection(config)
    return {
      ok: response.ok,
      tested: true,
      message: response.message,
    }
  },

  notion: async (config) => {
    const pending = getPendingOAuthMessage('notion', config)
    if (pending) return pending

    if (getConnectorAuthType(config) === 'oauth') {
      const token = getRequiredAccessToken('notion', config, 'Missing OAuth access token')
      if (!token.ok) return token.result

      return testRemoteMcpConnection({
        label: 'Notion',
        url: getConnectorMcpServerUrl('notion', config),
        token: token.token,
      })
    }

    const token = getRequiredAccessToken('notion', config, 'Missing API key')
    if (!token.ok) return token.result

    const response = await fetchWithTimeout('https://api.notion.com/v1/users/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Notion-Version': '2022-06-28',
      },
    })

    if (!response.ok) {
      return { ok: false, tested: true, message: `Notion test failed (${response.status})` }
    }

    return { ok: true, tested: true, message: 'Notion connection verified.' }
  },

  linear: async (config) => {
    const pending = getPendingOAuthMessage('linear', config)
    if (pending) return pending

    const token = getRequiredAccessToken(
      'linear',
      config,
      getConnectorAuthType(config) === 'oauth' ? 'Missing OAuth access token' : 'Missing API key'
    )
    if (!token.ok) return token.result

    return testRemoteMcpConnection({
      label: 'Linear',
      url: getConnectorMcpServerUrl('linear', config),
      token: token.token,
    })
  },

  custom: async (config, options) => {
    const pending = getPendingOAuthMessage('custom', config)
    if (pending) return pending

    if (getConnectorAuthType(config) === 'oauth') {
      const token = getRequiredAccessToken('custom', config, 'Missing OAuth access token')
      if (!token.ok) return token.result

      const mcpUrl = options.customEndpointUrl?.toString() ?? getConnectorMcpServerUrl('custom', config)
      if (!mcpUrl) {
        return { ok: false, tested: false, message: 'Missing endpoint' }
      }

      return testRemoteMcpConnection({
        label: 'Custom',
        url: mcpUrl,
        token: token.token,
      })
    }

    const endpoint = typeof config.endpoint === 'string' ? config.endpoint : ''
    if (!endpoint) {
      return { ok: false, tested: false, message: 'Missing endpoint' }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    const auth = typeof config.auth === 'string' ? config.auth : ''
    if (auth) {
      headers.Authorization = `Bearer ${auth}`
    }

    const response = await fetchWithTimeout(options.customEndpointUrl ?? endpoint, {
      method: 'GET',
      headers,
      redirect: 'manual',
    })

    if (!response.ok) {
      return { ok: false, tested: true, message: `Custom endpoint test failed (${response.status})` }
    }

    return { ok: true, tested: true, message: 'Custom endpoint reachable.' }
  },

  google_gmail: async (config) => {
    const pending = getPendingOAuthMessage('google_gmail', config)
    if (pending) return pending

    const token = getRequiredAccessToken('google_gmail', config, 'Missing OAuth access token')
    if (!token.ok) return token.result

    const url = getConnectorMcpServerUrl('google_gmail', config)
    if (!url) {
      return { ok: false, tested: false, message: 'Missing MCP server URL' }
    }

    return testRemoteMcpConnection({
      label: 'Gmail',
      url,
      token: token.token,
    })
  },

  google_drive: async (config) => {
    const pending = getPendingOAuthMessage('google_drive', config)
    if (pending) return pending

    const token = getRequiredAccessToken('google_drive', config, 'Missing OAuth access token')
    if (!token.ok) return token.result

    const url = getConnectorMcpServerUrl('google_drive', config)
    if (!url) {
      return { ok: false, tested: false, message: 'Missing MCP server URL' }
    }

    return testRemoteMcpConnection({
      label: 'Google Drive',
      url,
      token: token.token,
    })
  },

  google_calendar: async (config) => {
    const pending = getPendingOAuthMessage('google_calendar', config)
    if (pending) return pending

    const token = getRequiredAccessToken('google_calendar', config, 'Missing OAuth access token')
    if (!token.ok) return token.result

    const url = getConnectorMcpServerUrl('google_calendar', config)
    if (!url) {
      return { ok: false, tested: false, message: 'Missing MCP server URL' }
    }

    return testRemoteMcpConnection({
      label: 'Google Calendar',
      url,
      token: token.token,
    })
  },

  google_chat: async (config) => {
    const pending = getPendingOAuthMessage('google_chat', config)
    if (pending) return pending

    const token = getRequiredAccessToken('google_chat', config, 'Missing OAuth access token')
    if (!token.ok) return token.result

    const url = getConnectorMcpServerUrl('google_chat', config)
    if (!url) {
      return { ok: false, tested: false, message: 'Missing MCP server URL' }
    }

    return testRemoteMcpConnection({
      label: 'Google Chat',
      url,
      token: token.token,
    })
  },

  google_people: async (config) => {
    const pending = getPendingOAuthMessage('google_people', config)
    if (pending) return pending

    const token = getRequiredAccessToken('google_people', config, 'Missing OAuth access token')
    if (!token.ok) return token.result

    const url = getConnectorMcpServerUrl('google_people', config)
    if (!url) {
      return { ok: false, tested: false, message: 'Missing MCP server URL' }
    }

    return testRemoteMcpConnection({
      label: 'People API',
      url,
      token: token.token,
    })
  },
}

export function getCustomConnectorTestEndpoint(config: Record<string, unknown>): string | null {
  return getConnectorAuthType(config) === 'oauth'
    ? getConnectorMcpServerUrl('custom', config)
    : (typeof config.endpoint === 'string' ? config.endpoint : null)
}

export async function testConnectorConnection(
  type: ConnectorType,
  config: Record<string, unknown>,
  options: TestConnectionOptions = {}
): Promise<TestConnectionResult> {
  try {
    return await CONNECTOR_TEST_HANDLERS[type](config, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed'
    return { ok: false, tested: true, message }
  }
}
