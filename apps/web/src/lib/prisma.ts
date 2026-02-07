import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

declare global {
  var prisma: PrismaClient | undefined
  var prismaPool: Pool | undefined
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const pool = globalThis.prismaPool ?? new Pool({ connectionString })
if (process.env.NODE_ENV !== 'production') globalThis.prismaPool = pool

const adapter = new PrismaPg(pool)

export const prisma = globalThis.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
