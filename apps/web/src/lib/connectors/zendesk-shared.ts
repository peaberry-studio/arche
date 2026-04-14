export const ZENDESK_MCP_PROTOCOL_VERSION = '2025-03-26'

export function normalizeZendeskSubdomain(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '')
  const host = withoutProtocol.split(/[/?#]/, 1)[0] ?? withoutProtocol
  return host.replace(/\.zendesk\.com$/, '')
}
