import { join } from 'path'

import { getKbConfigRoot } from '@/lib/runtime/paths'

function getDesktopDatabasePath(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/^file:/, '')
  }
  const root = getKbConfigRoot()
  return join(root, '..', 'arche.db')
}

export async function createDesktopPrismaClient(): Promise<unknown> {
  const dbPath = getDesktopDatabasePath()

  // Lazy-load desktop dependencies to avoid errors in web runtime
  // These packages are only installed for the desktop build
  const { PrismaClient } = await import('@/generated/prisma-desktop') as {
    PrismaClient: new (opts: { datasourceUrl: string }) => unknown
  }

  return new PrismaClient({
    datasourceUrl: `file:${dbPath}`,
  })
}
