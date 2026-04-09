import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'path'

import type { PrismaClient } from '@prisma/client'

import type { RuntimeSessionResult } from '@/lib/runtime/types'

type DesktopVaultRuntimeContext = {
  databaseUrl: string
  initPromise?: Promise<void>
  prismaClient?: PrismaClient
  prismaClientPromise?: Promise<PrismaClient>
  session?: RuntimeSessionResult
  vaultRoot: string
}

const desktopVaultRuntimeContext = new AsyncLocalStorage<DesktopVaultRuntimeContext>()

export function runWithDesktopVaultContext<T>(vaultRoot: string, callback: () => Promise<T>): Promise<T> {
  return desktopVaultRuntimeContext.run(
    {
      databaseUrl: `file:${join(vaultRoot, '.arche.db')}`,
      vaultRoot,
    },
    callback,
  )
}

export function getDesktopVaultRuntimeContext(): DesktopVaultRuntimeContext | null {
  return desktopVaultRuntimeContext.getStore() ?? null
}
