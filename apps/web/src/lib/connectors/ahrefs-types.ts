export type AhrefsConnectorConfig = {
  apiKey: string
}

export type AhrefsApiResponse =
  | {
      ok: true
      data: unknown
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

export type AhrefsMcpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type AhrefsMcpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}
