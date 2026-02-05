'use server'

import { cookies } from 'next/headers'
import argon2 from 'argon2'

import { prisma } from '@/lib/prisma'
import {
  SESSION_COOKIE_NAME,
  getSessionFromToken,
  auditEvent,
  verifyPassword,
} from '@/lib/auth'
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  generateTotpUri,
  verifyTotp,
  generateRecoveryCodes,
} from '@/lib/totp'

const ISSUER = 'Arche'

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
}

export async function initiate2FASetup(): Promise<
  { ok: true; qrUri: string; secret: string } | { ok: false; error: string }
> {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return { ok: false, error: 'User not found' }
  if (user.totpEnabled) return { ok: false, error: '2FA is already enabled' }

  const secret = generateSecret()
  const encrypted = encryptSecret(secret)

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: encrypted, totpVerifiedAt: null },
  })

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
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
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
    recoveryCodes.map((c) => argon2.hash(c))
  )

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpVerifiedAt: new Date() },
    })

    await tx.twoFactorRecovery.deleteMany({ where: { userId: user.id } })

    await tx.twoFactorRecovery.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId: user.id,
        codeHash,
      })),
    })
  })

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.enabled',
  })

  return { ok: true, recoveryCodes }
}

export async function disable2FA(
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return { ok: false, error: 'User not found' }
  if (!user.totpEnabled) return { ok: false, error: '2FA is not enabled' }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { ok: false, error: 'Invalid password' }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpVerifiedAt: null,
        totpLastUsedAt: null,
      },
    })

    await tx.twoFactorRecovery.deleteMany({ where: { userId: user.id } })
  })

  await auditEvent({
    actorUserId: user.id,
    action: '2fa.disabled',
  })

  return { ok: true }
}

export async function regenerateRecoveryCodes(password: string): Promise<
  { ok: true; recoveryCodes: string[] } | { ok: false; error: string }
> {
  if (!password) return { ok: false, error: 'Password is required' }

  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return { ok: false, error: 'User not found' }
  if (!user.totpEnabled) return { ok: false, error: '2FA is not enabled' }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { ok: false, error: 'Invalid password' }

  const recoveryCodes = generateRecoveryCodes()
  const hashedCodes = await Promise.all(
    recoveryCodes.map((c) => argon2.hash(c))
  )

  await prisma.$transaction(async (tx) => {
    await tx.twoFactorRecovery.deleteMany({ where: { userId: user.id } })

    await tx.twoFactorRecovery.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId: user.id,
        codeHash,
      })),
    })
  })

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
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false, error: 'Not authenticated' }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return { ok: false, error: 'User not found' }

  const recoveryCodesRemaining = await prisma.twoFactorRecovery.count({
    where: { userId: user.id, usedAt: null },
  })

  return {
    ok: true,
    enabled: user.totpEnabled,
    verifiedAt: user.totpVerifiedAt,
    recoveryCodesRemaining,
  }
}
