import type { RuntimeSessionResult } from '@/lib/runtime/types'

import { prisma } from '@/lib/prisma'

const DESKTOP_USER_ID = 'local'
const DESKTOP_USER_EMAIL = 'local@arche.local'
const DESKTOP_USER_SLUG = 'local'
const DESKTOP_PASSWORD_HASH = 'desktop-local'

export async function getDesktopSession(): Promise<RuntimeSessionResult> {
  const user = await prisma.user.upsert({
    where: { slug: DESKTOP_USER_SLUG },
    update: {
      email: DESKTOP_USER_EMAIL,
      role: 'ADMIN',
    },
    create: {
      id: DESKTOP_USER_ID,
      email: DESKTOP_USER_EMAIL,
      slug: DESKTOP_USER_SLUG,
      role: 'ADMIN',
      passwordHash: DESKTOP_PASSWORD_HASH,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
    },
  })

  return {
    user,
    sessionId: user.id,
  }
}
