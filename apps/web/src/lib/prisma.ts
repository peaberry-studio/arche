import type { PrismaClient } from '@prisma/client'

import { isDesktop } from '@/lib/runtime/mode'

declare global {
  var prisma: PrismaClient | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var prismaPool: any
  var prismaDesktopClient: PrismaClient | undefined
}

async function createWebClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')

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

/**
 * Initialize the web PostgreSQL Prisma client. Called during instrumentation
 * in web (non-desktop) mode.
 */
export async function initWebPrisma(): Promise<void> {
  if (globalThis.prisma) return
  globalThis.prisma = await createWebClient()
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
      const value = (client as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof value === 'function') {
        return value.bind(client)
      }
      return value
    },
  })
}

function createWebProxy(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = globalThis.prisma
      if (!client) {
        throw new Error(
          'Web Prisma client not initialized. Call initWebPrisma() at startup.'
        )
      }
      const value = (client as unknown as Record<string | symbol, unknown>)[prop]
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

  return createWebProxy()
}

export const prisma: PrismaClient = globalThis.prisma ?? initPrisma()
