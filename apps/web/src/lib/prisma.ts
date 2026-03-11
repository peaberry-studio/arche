import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { isDesktop } from '@/lib/runtime/mode'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var prismaPool: Pool | undefined
  // eslint-disable-next-line no-var
  var prismaDesktopClient: PrismaClient | undefined
}

function createWebClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = globalThis.prismaPool ?? new Pool({ connectionString })
  if (process.env.NODE_ENV !== 'production') globalThis.prismaPool = pool

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

/**
 * Initialize the desktop SQLite Prisma client. Must be called once before
 * any service accesses `prisma`. Typically called during app startup
 * (e.g. in Next.js instrumentation or a startup module).
 */
export async function initDesktopPrisma(): Promise<void> {
  if (globalThis.prismaDesktopClient) return

  const { getDesktopPrismaClient, initDesktopDatabase } = await import('@/lib/prisma-desktop')
  const client = await getDesktopPrismaClient()
  globalThis.prismaDesktopClient = client as PrismaClient
  await initDesktopDatabase()
}

function createDesktopProxy(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = globalThis.prismaDesktopClient
      if (!client) {
        throw new Error(
          'Desktop Prisma client not initialized. Call initDesktopPrisma() at startup.'
        )
      }
      const value = (client as Record<string | symbol, unknown>)[prop]
      if (typeof value === 'function') {
        return value.bind(client)
      }
      return value
    },
  })
}

function initPrisma(): PrismaClient {
  if (isDesktop()) {
    return createDesktopProxy()
  }

  return createWebClient()
}

export const prisma: PrismaClient = globalThis.prisma ?? initPrisma()

if (!isDesktop() && process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
