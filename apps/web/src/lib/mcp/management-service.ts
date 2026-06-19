import { generatePat, generatePatSalt, hashPat, hashPatLookup } from '@/lib/mcp/pat'
import type { McpScope } from '@/lib/mcp/scopes'
import { prisma } from '@/lib/prisma'
import type { RuntimeUser } from '@/lib/runtime/types'
import { auditService, mcpSettingsService, patService } from '@/lib/services'
import type { McpUserAccess } from '@/lib/services/mcp-settings'
import type { PatListEntry } from '@/lib/services/personal-access-token'

type McpManagementResult<T, E extends string> =
  | ({ ok: true } & T)
  | { ok: false; error: E }

type McpActorInput = {
  actor: RuntimeUser
}

type McpUserScopedInput = McpActorInput & {
  slug: string
}

export type CreateUserMcpTokenResult = McpManagementResult<{
  record: PatListEntry
  token: string
}, 'forbidden' | 'mcp_disabled' | 'mcp_user_disallowed' | 'write_failed'>

export async function getUserMcpSettings(input: McpUserScopedInput): Promise<McpManagementResult<{
  enabled: boolean
  mcpAllowed: boolean
}, 'forbidden'>> {
  if (!isSlugOwner(input)) return { ok: false, error: 'forbidden' }

  const [settings, mcpAllowed] = await Promise.all([
    mcpSettingsService.getSettings(),
    mcpSettingsService.isUserAllowed(input.actor.id),
  ])

  return { ok: true, enabled: settings.enabled, mcpAllowed }
}

export async function listUserMcpTokens(input: McpUserScopedInput): Promise<McpManagementResult<{
  tokens: PatListEntry[]
}, 'forbidden'>> {
  if (!isSlugOwner(input)) return { ok: false, error: 'forbidden' }

  return { ok: true, tokens: await patService.findManyByUserId(input.actor.id) }
}

export async function createUserMcpToken(input: McpUserScopedInput & {
  expiresInDays: number | null
  name: string
  scopes: McpScope[]
}): Promise<CreateUserMcpTokenResult> {
  if (!isSlugOwner(input)) return { ok: false, error: 'forbidden' }

  const [settings, mcpAllowed] = await Promise.all([
    mcpSettingsService.getSettings(),
    mcpSettingsService.isUserAllowed(input.actor.id),
  ])
  if (!settings.enabled) return { ok: false, error: 'mcp_disabled' }
  if (!mcpAllowed) return { ok: false, error: 'mcp_user_disallowed' }

  const token = generatePat()
  const salt = generatePatSalt()
  const expiresAt = input.expiresInDays !== null
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  try {
    const record = await prisma.$transaction(async (tx) => {
      await patService.revokeAllActiveByUserId(input.actor.id, tx)

      const created = await tx.personalAccessToken.create({
        data: {
          userId: input.actor.id,
          name: input.name,
          lookupHash: hashPatLookup(token),
          tokenHash: hashPat(token, salt),
          salt,
          scopes: input.scopes,
          expiresAt,
        },
      })

      await auditService.createEventStrict({
        actorUserId: input.actor.id,
        action: 'mcp.token_created',
        metadata: { tokenId: created.id, scopes: created.scopes },
      }, tx)

      return created
    })

    return { ok: true, token, record }
  } catch (error) {
    return writeFailedResult(error)
  }
}

export async function revokeUserMcpToken(input: McpUserScopedInput & {
  tokenId: string
}): Promise<McpManagementResult<object, 'forbidden' | 'not_found' | 'write_failed'>> {
  if (!isSlugOwner(input)) return { ok: false, error: 'forbidden' }

  try {
    const revoked = await prisma.$transaction(async (tx) => {
      const result = await patService.revokeByIdAndUserId(input.tokenId, input.actor.id, tx)
      if (result.count === 0) return false

      await auditService.createEventStrict({
        actorUserId: input.actor.id,
        action: 'mcp.token_revoked',
        metadata: { tokenId: input.tokenId },
      }, tx)

      return true
    })

    if (!revoked) return { ok: false, error: 'not_found' }
  } catch (error) {
    return writeFailedResult(error)
  }

  return { ok: true }
}

export async function listAdminMcpTokens(input: McpActorInput): Promise<McpManagementResult<{
  tokens: PatListEntry[]
}, 'forbidden'>> {
  if (!isAdmin(input.actor)) return { ok: false, error: 'forbidden' }

  return { ok: true, tokens: await patService.findManyWithUsers() }
}

export async function getAdminMcpSettings(input: McpActorInput): Promise<McpManagementResult<{
  enabled: boolean
  mcpAllowed: boolean
  users: McpUserAccess[]
}, 'forbidden'>> {
  if (!isAdmin(input.actor)) return { ok: false, error: 'forbidden' }

  const [settings, mcpAllowed, users] = await Promise.all([
    mcpSettingsService.getSettings(),
    mcpSettingsService.isUserAllowed(input.actor.id),
    mcpSettingsService.listUserAccess(),
  ])

  return { ok: true, enabled: settings.enabled, mcpAllowed, users }
}

export async function setAdminMcpEnabled(input: McpActorInput & {
  enabled: boolean
}): Promise<McpManagementResult<{
  enabled: boolean
  mcpAllowed: boolean
  users: McpUserAccess[]
}, 'forbidden' | 'write_failed'>> {
  if (!isAdmin(input.actor)) return { ok: false, error: 'forbidden' }

  let settings: { enabled: boolean }
  try {
    settings = await prisma.$transaction(async (tx) => {
      const updatedSettings = await mcpSettingsService.setEnabled(input.enabled, tx)
      await auditService.createEventStrict({
        actorUserId: input.actor.id,
        action: input.enabled ? 'mcp.enabled' : 'mcp.disabled',
      }, tx)

      return updatedSettings
    })
  } catch (error) {
    return writeFailedResult(error)
  }

  const [mcpAllowed, users] = await Promise.all([
    mcpSettingsService.isUserAllowed(input.actor.id),
    mcpSettingsService.listUserAccess(),
  ])

  return { ok: true, enabled: settings.enabled, mcpAllowed, users }
}

export async function setAdminMcpUserAllowed(input: McpActorInput & {
  mcpAllowed: boolean
  userId: string
}): Promise<McpManagementResult<{
  user: McpUserAccess
}, 'forbidden' | 'write_failed'>> {
  if (!isAdmin(input.actor)) return { ok: false, error: 'forbidden' }

  let user: McpUserAccess
  try {
    user = await prisma.$transaction(async (tx) => {
      const updatedUser = await mcpSettingsService.setUserAllowed(input.userId, input.mcpAllowed, tx)
      await auditService.createEventStrict({
        actorUserId: input.actor.id,
        action: input.mcpAllowed ? 'mcp.user_allowed' : 'mcp.user_disallowed',
        metadata: { userId: updatedUser.id, userSlug: updatedUser.slug },
      }, tx)

      return updatedUser
    })
  } catch (error) {
    return writeFailedResult(error)
  }

  return { ok: true, user }
}

export async function revokeAdminMcpToken(input: McpActorInput & {
  tokenId: string
}): Promise<McpManagementResult<object, 'forbidden' | 'not_found' | 'write_failed'>> {
  if (!isAdmin(input.actor)) return { ok: false, error: 'forbidden' }

  try {
    const revoked = await prisma.$transaction(async (tx) => {
      const result = await patService.revokeById(input.tokenId, tx)
      if (result.count === 0) return false

      await auditService.createEventStrict({
        actorUserId: input.actor.id,
        action: 'mcp.admin_token_revoked',
        metadata: { tokenId: input.tokenId },
      }, tx)

      return true
    })

    if (!revoked) return { ok: false, error: 'not_found' }
  } catch (error) {
    return writeFailedResult(error)
  }

  return { ok: true }
}

function isAdmin(actor: RuntimeUser): boolean {
  return actor.role === 'ADMIN'
}

function isSlugOwner(input: McpUserScopedInput): boolean {
  return input.actor.slug === input.slug
}

function writeFailedResult(error: unknown): { ok: false; error: 'write_failed' } {
  if (error instanceof Error) return { ok: false, error: 'write_failed' }

  return { ok: false, error: 'write_failed' }
}
