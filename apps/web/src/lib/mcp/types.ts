import { isRecord } from '@/lib/records'

export type McpErrorResponse = {
  error: string
}

export type McpUserAccessDto = {
  id: string
  email: string
  slug: string
  role: string
  mcpAllowed: boolean
}

export type McpTokenDto = {
  id: string
  name: string
  scopes: string[]
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  user?: {
    id: string
    email: string
    slug: string
  }
}

export type McpUserSettingsResponse = {
  enabled: boolean
  mcpAllowed: boolean
}

export type McpAdminSettingsResponse = McpUserSettingsResponse & {
  users: McpUserAccessDto[]
}

export type McpTokenListResponse = {
  tokens: McpTokenDto[]
}

export type McpCreateTokenResponse = {
  token: string
  record: McpTokenDto
}

export type McpUpdateUserAccessResponse = {
  user: McpUserAccessDto
}

export type McpOkResponse = {
  ok: true
}

export type CreateMcpTokenRequest = {
  expiresInDays?: unknown
  name?: unknown
  scopes?: unknown
}

export type UpdateMcpSettingsRequest = {
  enabled?: unknown
}

export type UpdateMcpUserAccessRequest = {
  mcpAllowed?: unknown
}

export type SerializableMcpToken = {
  id: string
  name: string
  scopes: string[]
  expiresAt: Date | null
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  user?: { id: string; email: string; slug: string }
}

export function serializeMcpToken(token: SerializableMcpToken): McpTokenDto {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    ...(token.user ? { user: token.user } : {}),
  }
}

export function mcpManagementErrorStatus(error: string): number {
  if (error === 'not_found') return 404
  if (error === 'write_failed') return 500

  return 403
}

export function isMcpErrorResponse(data: unknown): data is McpErrorResponse {
  return isRecord(data) && typeof data.error === 'string'
}

export function parseMcpUserSettingsResponse(data: unknown): McpUserSettingsResponse | null {
  if (!isRecord(data)) return null
  if (typeof data.enabled !== 'boolean') return null
  if (typeof data.mcpAllowed !== 'boolean') return null

  return { enabled: data.enabled, mcpAllowed: data.mcpAllowed }
}

export function parseMcpAdminSettingsResponse(data: unknown): McpAdminSettingsResponse | null {
  const settings = parseMcpUserSettingsResponse(data)
  if (!settings || !isRecord(data) || !Array.isArray(data.users)) return null
  const { users } = data
  if (!users.every(isMcpUserAccessDto)) return null

  return { ...settings, users }
}

export function parseMcpTokenListResponse(data: unknown): McpTokenListResponse | null {
  if (!isRecord(data) || !Array.isArray(data.tokens)) return null
  const { tokens } = data
  if (!tokens.every(isMcpTokenDto)) return null

  return { tokens }
}

export function parseMcpCreateTokenResponse(data: unknown): McpCreateTokenResponse | null {
  if (!isRecord(data)) return null
  if (typeof data.token !== 'string') return null
  const { record } = data
  if (!isMcpTokenDto(record)) return null

  return { token: data.token, record }
}

export function parseMcpUpdateUserAccessResponse(data: unknown): McpUpdateUserAccessResponse | null {
  if (!isRecord(data)) return null
  const { user } = data
  if (!isMcpUserAccessDto(user)) return null

  return { user }
}

export function parseMcpOkResponse(data: unknown): McpOkResponse | null {
  if (!isRecord(data) || data.ok !== true) return null

  return { ok: true }
}

function isMcpUserAccessDto(data: unknown): data is McpUserAccessDto {
  return isRecord(data)
    && typeof data.id === 'string'
    && typeof data.email === 'string'
    && typeof data.slug === 'string'
    && typeof data.role === 'string'
    && typeof data.mcpAllowed === 'boolean'
}

function isMcpTokenDto(data: unknown): data is McpTokenDto {
  if (!isRecord(data)) return false
  if (typeof data.id !== 'string') return false
  if (typeof data.name !== 'string') return false
  if (!Array.isArray(data.scopes) || !data.scopes.every((scope) => typeof scope === 'string')) return false
  if (data.expiresAt !== null && typeof data.expiresAt !== 'string') return false
  if (data.revokedAt !== null && typeof data.revokedAt !== 'string') return false
  if (data.lastUsedAt !== null && typeof data.lastUsedAt !== 'string') return false
  if (typeof data.createdAt !== 'string') return false
  if (data.user !== undefined && !isMcpTokenUserDto(data.user)) return false

  return true
}

function isMcpTokenUserDto(data: unknown): data is NonNullable<McpTokenDto['user']> {
  return isRecord(data)
    && typeof data.id === 'string'
    && typeof data.email === 'string'
    && typeof data.slug === 'string'
}
