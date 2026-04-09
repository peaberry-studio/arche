import type { RuntimeSessionResult } from '@/lib/runtime/types'

import { prisma } from '@/lib/prisma'
import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { initDesktopPrisma } from '@/lib/prisma-desktop-init'

const DESKTOP_USER_ID = 'local'
const DESKTOP_USER_EMAIL = 'local@arche.local'
const DESKTOP_USER_SLUG = 'local'
const DESKTOP_PASSWORD_HASH = 'desktop-local'

type DesktopSession = NonNullable<RuntimeSessionResult>

let cachedSession: DesktopSession | null = null

export async function getDesktopSession(): Promise<DesktopSession> {
  const context = getDesktopVaultRuntimeContext()
  if (context?.session) return context.session
  if (cachedSession) return cachedSession

  await initDesktopPrisma()

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

  const nextSession: DesktopSession = {
    user,
    sessionId: user.id,
  }

  if (context) {
    context.session = nextSession
    return nextSession
  }

  cachedSession = nextSession
  return nextSession
}
