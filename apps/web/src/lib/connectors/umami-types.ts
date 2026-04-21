export type UmamiAuthMethod = 'api-key' | 'login'

export type UmamiConnectorConfig =
  | {
      authMethod: 'api-key'
      baseUrl: string
      apiKey: string
    }
  | {
      authMethod: 'login'
      baseUrl: string
      username: string
      password: string
    }

export type UmamiToolName =
  | 'list_websites'
  | 'get_website_stats'
  | 'get_website_pageviews'
  | 'get_website_metrics'
  | 'list_sessions'
  | 'list_events'
  | 'get_realtime'

export type UmamiMcpTextContent = {
  type: 'text'
  text: string
}

export type UmamiMcpToolResult = {
  content: UmamiMcpTextContent[]
  isError?: boolean
}

export type UmamiMcpTool = {
  name: UmamiToolName
  description: string
  inputSchema: Record<string, unknown>
}

export type UmamiApiResponse<TData = unknown> =
  | {
      ok: true
      data: TData
      status: number
      headers: Headers
    }
  | {
      ok: false
      error: string
      message: string
      status: number
      headers?: Headers
      data?: unknown
      retryAfter?: number
    }
