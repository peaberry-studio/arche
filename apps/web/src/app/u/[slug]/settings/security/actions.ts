'use server'

import { hashArgon2 } from '@/lib/argon2'
import {
  auditEvent,
  verifyPassword,
} from '@/lib/auth'
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
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import { patService, sessionService, userService } from '@/lib/services'
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  generateTotpUri,
  verifyTotp,
  generateRecoveryCodes,
} from '@/lib/totp'

const ISSUER = 'Arche'
const MAX_PAT_TTL_DAYS = 90
const PAT_SCOPES = [...DEFAULT_MCP_PAT_SCOPES].sort((left, right) => left.localeCompare(right))
const DAY_MS = 24 * 60 * 60 * 1000

type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'password_change_unavailable'
        | 'not_authenticated'
        | 'user_not_found'
        | 'invalid_current_password'
        | 'invalid_new_password'
      message: string
    }

function invalidNewPassword(message: string): ChangePasswordResult {
  return {
    ok: false,
    error: 'invalid_new_password',
    message,
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  newPasswordConfirmation: string,
): Promise<ChangePasswordResult> {
  if (!getRuntimeCapabilities().auth) {
    return {
      ok: false,
      error: 'password_change_unavailable',
      message: 'Password change is not available in this runtime mode',
    }
  }

  if (!currentPassword) {
    return {
      ok: false,
      error: 'invalid_current_password',
      message: 'Current password is required',
    }
  }

  if (!newPassword) {
    return invalidNewPassword('New password is required')
  }

  if (!newPasswordConfirmation) {
    return invalidNewPassword('New password confirmation is required')
  }

  if (newPassword !== newPasswordConfirmation) {
    return invalidNewPassword('New password confirmation does not match')
  }

  if (newPassword === currentPassword) {
    return invalidNewPassword('New password must be different from the current password')
  }

  const session = await getSession()
  if (!session) {
    return {
      ok: false,
      error: 'not_authenticated',
      message: 'Not authenticated',
    }
  }

  const user = await userService.findById(session.user.id)
  if (!user) {
    return {
      ok: false,
      error: 'user_not_found',
      message: 'User not found',
    }
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) {
    return {
      ok: false,
      error: 'invalid_current_password',
      message: 'Current password is incorrect',
    }
  }

  const passwordHash = await hashArgon2(newPassword)
  await userService.updatePasswordHash(user.id, passwordHash)
  await sessionService.revokeByUserIdExceptSession(user.id, session.sessionId)

  await auditEvent({
    actorUserId: user.id,
    action: 'auth.password.changed',
  })

  return { ok: true }
}

export async function initiate2FASetup(): Promise<
  { ok: true; qrUri: string; secret: string } | { ok: false; error: string }
> {
  if (!getRuntimeCapabilities().twoFactor) return { ok: false, error: '2FA is not available in this runtime mode' }

  const session = await getSession()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await userService.findById(session.user.id)
  if (!user) return { ok: false, error: 'User not found' }
  if (user.totpEnabled) return { ok: false, error: '2FA is already enabled' }

  const secret = generateSecret()
  const encrypted = encryptSecret(secret)

  await userService.updateTotpSecret(user.id, encrypted)

  const qrUri = generateTotpUri({ secret, email: user.email, issuer: ISSUER })

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.setup_initiated',
  })

  return { ok: true, qrUri, secret }
}

export async function verify2FASetup(
  code: string
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  if (!getRuntimeCapabilities().twoFactor) return { ok: false, error: '2FA is not available in this runtime mode' }

  const session = await getSession()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await userService.findById(session.user.id)
  if (!user) return { ok: false, error: 'User not found' }
  if (user.totpEnabled) return { ok: false, error: '2FA is already enabled' }
  if (!user.totpSecret) return { ok: false, error: '2FA setup not initiated' }

  const secret = decryptSecret(user.totpSecret)
  const result = verifyTotp(secret, code)
  if (!result.valid) {
    await auditEvent({
      actorUserId: user.id,
      action: '2fa.setup_verification_failed',
    })
    return { ok: false, error: 'Invalid code' }
  }

  const recoveryCodes = generateRecoveryCodes()
  const hashedCodes = await Promise.all(
    recoveryCodes.map((c) => hashArgon2(c))
  )

  await userService.enableTwoFactor(
    user.id,
    hashedCodes.map((codeHash) => ({ userId: user.id, codeHash })),
  )

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.enabled',
  })

  return { ok: true, recoveryCodes }
}

export async function disable2FA(
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getRuntimeCapabilities().twoFactor) return { ok: false, error: '2FA is not available in this runtime mode' }

  const session = await getSession()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await userService.findById(session.user.id)
  if (!user) return { ok: false, error: 'User not found' }
  if (!user.totpEnabled) return { ok: false, error: '2FA is not enabled' }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { ok: false, error: 'Invalid password' }

  await userService.disableTwoFactor(user.id)

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.disabled',
  })

  return { ok: true }
}

export async function regenerateRecoveryCodes(password: string): Promise<
  { ok: true; recoveryCodes: string[] } | { ok: false; error: string }
> {
  if (!getRuntimeCapabilities().twoFactor) return { ok: false, error: '2FA is not available in this runtime mode' }

  if (!password) return { ok: false, error: 'Password is required' }

  const session = await getSession()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await userService.findById(session.user.id)
  if (!user) return { ok: false, error: 'User not found' }
  if (!user.totpEnabled) return { ok: false, error: '2FA is not enabled' }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { ok: false, error: 'Invalid password' }

  const recoveryCodes = generateRecoveryCodes()
  const hashedCodes = await Promise.all(
    recoveryCodes.map((c) => hashArgon2(c))
  )

  await userService.regenerateRecoveryCodes(
    user.id,
    hashedCodes.map((codeHash) => ({ userId: user.id, codeHash })),
  )

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.recovery_codes_regenerated',
  })

  return { ok: true, recoveryCodes }
}

export async function get2FAStatus(): Promise<
  | { ok: true; enabled: boolean; verifiedAt: Date | null; recoveryCodesRemaining: number }
  | { ok: false; error: string }
> {
  if (!getRuntimeCapabilities().twoFactor) return { ok: false, error: '2FA is not available in this runtime mode' }

  const session = await getSession()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await userService.findById(session.user.id)
  if (!user) return { ok: false, error: 'User not found' }

  const recoveryCodesRemaining = await userService.countUnusedRecoveryCodes(user.id)

  return {
    ok: true,
    enabled: user.totpEnabled,
    verifiedAt: user.totpVerifiedAt,
    recoveryCodesRemaining,
  }
}

export async function setMcpEnabled(
  enabled: boolean
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

export async function createPersonalAccessToken(input: {
  name: string
  expiresInDays: number
  scopes?: string[]
}): Promise<
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

  const mcpSettings = await readMcpSettings()
  if (!mcpSettings.ok) {
    return { ok: false, error: formatMcpConfigError(mcpSettings.error) }
  }

  if (!mcpSettings.enabled) {
    return { ok: false, error: 'MCP is disabled' }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, error: 'Not authenticated' }
  }

  const name = input.name.trim()
  if (!name) {
    return { ok: false, error: 'Token name is required' }
  }

  const expiresInDays = Math.floor(input.expiresInDays)
  if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_PAT_TTL_DAYS) {
    return { ok: false, error: `Expiration must be between 1 and ${MAX_PAT_TTL_DAYS} days` }
  }

  const scopesResult = parsePatScopes(input.scopes)
  if (!scopesResult.ok) {
    return { ok: false, error: scopesResult.error }
  }

  const token = generatePat()
  const salt = generatePatSalt()
  const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS)

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
