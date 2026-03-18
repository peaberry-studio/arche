import type { PrismaClient } from '@prisma/client'

declare global {
  var prismaDesktopClient: PrismaClient | undefined
}

export async function initDesktopPrisma(): Promise<void> {
  if (globalThis.prismaDesktopClient) return

  const { getDesktopPrismaClient, initDesktopDatabase } = await import('@/lib/prisma-desktop')
  const client = await getDesktopPrismaClient()
  globalThis.prismaDesktopClient = client as PrismaClient
  await initDesktopDatabase()
}
