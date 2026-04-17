'use server'

import { hashArgon2 } from '@/lib/argon2'
import {
  auditEvent,
  verifyPassword,
} from '@/lib/auth'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import { sessionService, userService } from '@/lib/services'
import {
  generateSecret,
  encryptSecret,
  decryptSecret,
  generateTotpUri,
  verifyTotp,
  generateRecoveryCodes,
} from '@/lib/totp'

const ISSUER = 'Arche'

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
