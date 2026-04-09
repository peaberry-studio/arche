import type { PrismaClient } from '@prisma/client'

import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'

declare global {
  var prismaDesktopClient: PrismaClient | undefined
}

let initPromise: Promise<void> | null = null

export async function initDesktopPrisma(): Promise<void> {
  const context = getDesktopVaultRuntimeContext()
  if (context?.prismaClient) return

  if (context) {
    if (!context.initPromise) {
      context.initPromise = doInit()
    }

    return context.initPromise
  }

  if (globalThis.prismaDesktopClient) return

  if (!initPromise) {
    initPromise = doInit()
  }

  return initPromise
}

async function doInit(): Promise<void> {
  const { getDesktopPrismaClient, initDesktopDatabase } = await import('@/lib/prisma-desktop')
  const client = await getDesktopPrismaClient()
  const context = getDesktopVaultRuntimeContext()
  if (context) {
    context.prismaClient = client as PrismaClient
  } else {
    globalThis.prismaDesktopClient = client as PrismaClient
  }
  await initDesktopDatabase()
}
