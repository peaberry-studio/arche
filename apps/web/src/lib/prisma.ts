import type { PrismaClient } from '@prisma/client'

import { isDesktop } from '@/lib/runtime/mode'

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

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

  const { PrismaClient } = await importRuntimeModule<typeof import('@prisma/client')>('@prisma/client')
  const { PrismaPg } = await importRuntimeModule<typeof import('@prisma/adapter-pg')>('@prisma/adapter-pg')
  const { Pool } = await importRuntimeModule<typeof import('pg')>('pg')

  const pool = globalThis.prismaPool ?? new Pool({ connectionString })
  if (process.env.NODE_ENV !== 'production') globalThis.prismaPool = pool

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
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
