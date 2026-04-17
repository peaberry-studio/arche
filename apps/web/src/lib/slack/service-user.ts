import { userService } from '@/lib/services'

export const SLACK_SERVICE_USER_EMAIL = 'slack-bot@arche.local'
export const SLACK_SERVICE_USER_SLUG = 'slack-bot'
const SLACK_SERVICE_USER_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$Rd07A5lN6/xNvx47pvH1Gw$J5TKBjCI3UOaBd2uUHMbX/AdzYT+/pvqx1io3emVwsU'

export type EnsureSlackServiceUserResult =
  | { ok: true; user: { id: string; slug: string } }
  | { ok: false; error: 'service_user_conflict' | 'service_user_create_failed' }

export async function ensureSlackServiceUser(): Promise<EnsureSlackServiceUserResult> {
  const existing = await userService.findExistingByEmailOrSlug(
    SLACK_SERVICE_USER_EMAIL,
    SLACK_SERVICE_USER_SLUG,
  )

  if (existing) {
    if (
      existing.kind !== 'SERVICE' ||
      existing.email !== SLACK_SERVICE_USER_EMAIL ||
      existing.slug !== SLACK_SERVICE_USER_SLUG
    ) {
      return { ok: false, error: 'service_user_conflict' }
    }

    return {
      ok: true,
      user: {
        id: existing.id,
        slug: existing.slug,
      },
    }
  }

  try {
    const created = await userService.create({
      email: SLACK_SERVICE_USER_EMAIL,
      kind: 'SERVICE',
      passwordHash: SLACK_SERVICE_USER_PASSWORD_HASH,
      role: 'USER',
      slug: SLACK_SERVICE_USER_SLUG,
    })

    return {
      ok: true,
      user: {
        id: created.id,
        slug: created.slug,
      },
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return ensureSlackServiceUser()
    }

    return { ok: false, error: 'service_user_create_failed' }
  }
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}
