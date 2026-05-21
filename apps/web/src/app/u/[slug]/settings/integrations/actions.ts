'use server'

import { auditEvent } from '@/lib/auth'
import {
  generatePat,
  generatePatSalt,
  hashPat,
  hashPatLookup,
} from '@/lib/mcp/pat'
import {
  DEFAULT_MCP_PAT_SCOPES,
  isMcpScope,
  type McpScope,
} from '@/lib/mcp/scopes'
import { readMcpSettings, writeMcpSettings } from '@/lib/mcp/settings'
import { checkRateLimit } from '@/lib/rate-limit'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import { patService } from '@/lib/services'

const MAX_ACTIVE_PAT_COUNT = 10
const MAX_PAT_TTL_DAYS = 90
const PAT_CREATION_RATE_LIMIT_MAX = 5
const PAT_CREATION_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const PAT_SCOPES = [...DEFAULT_MCP_PAT_SCOPES].sort((left, right) => left.localeCompare(right))
const DAY_MS = 24 * 60 * 60 * 1000

export async function setMcpEnabled(
  enabled: unknown
): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  if (!getRuntimeCapabilities().mcp) {
    return { ok: false, error: 'MCP is not available in this runtime mode' }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, error: 'Not authenticated' }
  }

  if (session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only administrators can change MCP settings' }
  }

  if (typeof enabled !== 'boolean') {
    return { ok: false, error: 'Invalid MCP enabled flag' }
  }

  const currentSettings = await readMcpSettings()
  const writeResult = await writeMcpSettings(
    enabled,
    currentSettings.ok ? currentSettings.hash : undefined
  )

  if (!writeResult.ok) {
    return { ok: false, error: formatMcpConfigError(writeResult.error) }
  }

  await auditEvent({
    actorUserId: session.user.id,
    action: 'mcp.settings_updated',
    metadata: { enabled },
  })

  return { ok: true, enabled: writeResult.enabled }
}

export async function createPersonalAccessToken(input: unknown): Promise<
  | {
      ok: true
      token: string
      tokenRecord: {
        id: string
        name: string
        scopes: string[]
        createdAt: string
        expiresAt: string
        lastUsedAt: string | null
        revokedAt: string | null
      }
    }
  | { ok: false; error: string }
> {
  if (!getRuntimeCapabilities().mcp) {
    return { ok: false, error: 'MCP is not available in this runtime mode' }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, error: 'Not authenticated' }
  }

  const parsedInput = parseCreatePersonalAccessTokenInput(input)
  if (!parsedInput.ok) {
    return { ok: false, error: parsedInput.error }
  }

  const mcpSettings = await readMcpSettings()
  if (!mcpSettings.ok) {
    return { ok: false, error: formatMcpConfigError(mcpSettings.error) }
  }

  if (!mcpSettings.enabled) {
    return { ok: false, error: 'MCP is disabled' }
  }

  const name = parsedInput.name.trim()
  if (!name) {
    return { ok: false, error: 'Token name is required' }
  }

  const expiresInDays = Math.floor(parsedInput.expiresInDays)
  if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_PAT_TTL_DAYS) {
    return { ok: false, error: `Expiration must be between 1 and ${MAX_PAT_TTL_DAYS} days` }
  }

  const scopesResult = parsePatScopes(parsedInput.scopes)
  if (!scopesResult.ok) {
    return { ok: false, error: scopesResult.error }
  }

  const createLimit = checkRateLimit(
    `mcp:pat:create:${session.user.id}`,
    PAT_CREATION_RATE_LIMIT_MAX,
    PAT_CREATION_RATE_LIMIT_WINDOW_MS
  )
  if (!createLimit.allowed) {
    return { ok: false, error: 'Too many token creation attempts. Please retry later.' }
  }

  const now = new Date()
  const activeCount = await patService.countActiveByUserId(session.user.id, now)
  if (activeCount >= MAX_ACTIVE_PAT_COUNT) {
    return { ok: false, error: `You can have at most ${MAX_ACTIVE_PAT_COUNT} active MCP tokens` }
  }

  const token = generatePat()
  const salt = generatePatSalt()
  const expiresAt = new Date(now.getTime() + expiresInDays * DAY_MS)

  const record = await patService.create({
    userId: session.user.id,
    name,
    lookupHash: hashPatLookup(token),
    tokenHash: hashPat(token, salt),
    salt,
    scopes: scopesResult.scopes,
    expiresAt,
  })

  await auditEvent({
    actorUserId: session.user.id,
    action: 'mcp.pat_created',
    metadata: {
      tokenId: record.id,
      name,
      expiresAt: record.expiresAt.toISOString(),
    },
  })

  return {
    ok: true,
    token,
    tokenRecord: {
      id: record.id,
      name: record.name,
      scopes: record.scopes,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    },
  }
}

export async function revokePersonalAccessToken(
  tokenId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getRuntimeCapabilities().mcp) {
    return { ok: false, error: 'MCP is not available in this runtime mode' }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, error: 'Not authenticated' }
  }

  const result = await patService.revokeByIdAndUserId(tokenId, session.user.id)
  if (result.count === 0) {
    return { ok: false, error: 'Token not found' }
  }

  await auditEvent({
    actorUserId: session.user.id,
    action: 'mcp.pat_revoked',
    metadata: { tokenId },
  })

  return { ok: true }
}

function parsePatScopes(
  value: string[] | undefined,
): { ok: true; scopes: McpScope[] } | { ok: false; error: string } {
  if (typeof value === 'undefined') {
    return { ok: true, scopes: PAT_SCOPES }
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: 'Invalid token scopes' }
  }

  const normalizedScopes = Array.from(
    new Set(
      value
        .filter((scope): scope is string => typeof scope === 'string')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0),
    ),
  )

  if (normalizedScopes.length === 0) {
    return { ok: false, error: 'Select at least one MCP permission' }
  }

  if (!normalizedScopes.every(isMcpScope)) {
    return { ok: false, error: 'Invalid token scopes' }
  }

  return {
    ok: true,
    scopes: normalizedScopes.sort((left, right) => left.localeCompare(right)) as McpScope[],
  }
}

function parseCreatePersonalAccessTokenInput(
  input: unknown,
):
  | { ok: true; expiresInDays: number; name: string; scopes?: string[] }
  | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: 'Invalid token request' }
  }

  const { expiresInDays, name, scopes } = input
  if (typeof name !== 'string' || typeof expiresInDays !== 'number') {
    return { ok: false, error: 'Invalid token request' }
  }

  if (typeof scopes !== 'undefined') {
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
      return { ok: false, error: 'Invalid token scopes' }
    }
  }

  return {
    ok: true,
    expiresInDays,
    name,
    scopes,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function formatMcpConfigError(error: string): string {
  switch (error) {
    case 'conflict':
      return 'MCP settings changed elsewhere. Please retry.'
    case 'not_found':
      return 'Knowledge base configuration is not initialized yet.'
    case 'kb_unavailable':
      return 'Knowledge base configuration is unavailable.'
    case 'invalid_config':
      return 'Knowledge base configuration is invalid.'
    default:
      return 'Failed to update MCP settings'
  }
}
