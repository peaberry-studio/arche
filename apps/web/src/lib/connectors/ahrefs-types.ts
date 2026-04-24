export type AhrefsConnectorConfig = {
  apiKey: string
}

export type AhrefsToolName =
  | 'get_domain_rating'
  | 'get_site_metrics'
  | 'get_backlinks'
  | 'get_organic_keywords'
  | 'get_top_pages'
  | 'get_keyword_overview'
  | 'get_serp_overview'
  | 'get_subscription_limits'

export type AhrefsApiResponse<TData = unknown> =
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

export type AhrefsMcpTextContent = {
  type: 'text'
  text: string
}

export type AhrefsMcpTool = {
  name: AhrefsToolName
  description: string
  inputSchema: Record<string, unknown>
}

export type AhrefsMcpToolResult = {
  content: AhrefsMcpTextContent[]
  isError?: boolean
}
