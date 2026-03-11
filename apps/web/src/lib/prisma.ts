import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { isDesktop } from '@/lib/runtime/mode'

declare global {
  var prisma: PrismaClient | undefined
  var prismaPool: Pool | undefined
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

function initPrisma(): PrismaClient {
  if (isDesktop()) {
    throw new Error(
      'Desktop Prisma client not yet implemented. Set ARCHE_RUNTIME_MODE=web or implement Phase 9.'
    )
  }

  return createWebClient()
}

export const prisma = globalThis.prisma ?? initPrisma()

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
