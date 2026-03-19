import type { PrismaClient } from '@prisma/client'

declare global {
  var prismaDesktopClient: PrismaClient | undefined
}

let initPromise: Promise<void> | null = null

export async function initDesktopPrisma(): Promise<void> {
  if (globalThis.prismaDesktopClient) return

  if (!initPromise) {
    initPromise = doInit()
  }

  return initPromise
}

async function doInit(): Promise<void> {
  const { getDesktopPrismaClient, initDesktopDatabase } = await import('@/lib/prisma-desktop')
  const client = await getDesktopPrismaClient()
  globalThis.prismaDesktopClient = client as PrismaClient
  await initDesktopDatabase()
}
