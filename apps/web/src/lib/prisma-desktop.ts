import { join } from 'path'

import { getKbConfigRoot } from '@/lib/runtime/paths'

function getDesktopDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  return `file:${join(getKbConfigRoot(), '..', 'arche.db')}`
}

export async function createDesktopPrismaClient(): Promise<unknown> {
  const url = getDesktopDatabaseUrl()
  void url
  throw new Error(
    'Desktop Prisma client not yet implemented. ' +
    'Install @prisma/adapter-libsql and generate the SQLite client first.'
  )
}
