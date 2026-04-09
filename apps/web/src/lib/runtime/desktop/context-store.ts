import type { PrismaClient } from '@prisma/client'

import type { RuntimeSessionResult } from '@/lib/runtime/types'

export type DesktopVaultRuntimeContext = {
  databaseUrl: string
  initPromise?: Promise<void>
  prismaClient?: PrismaClient
  prismaClientPromise?: Promise<PrismaClient>
  session?: RuntimeSessionResult
  vaultRoot: string
}

const DESKTOP_VAULT_CONTEXT_GETTER_KEY = Symbol.for('arche.desktop-vault-context-getter')

type DesktopVaultRuntimeContextGetter = () => DesktopVaultRuntimeContext | null

type GlobalWithDesktopVaultRuntimeContextGetter = typeof globalThis & {
  [DESKTOP_VAULT_CONTEXT_GETTER_KEY]?: DesktopVaultRuntimeContextGetter
}

export function setDesktopVaultRuntimeContextGetter(
  getter: DesktopVaultRuntimeContextGetter,
): void {
  (globalThis as GlobalWithDesktopVaultRuntimeContextGetter)[DESKTOP_VAULT_CONTEXT_GETTER_KEY] = getter
}

export function getDesktopVaultRuntimeContext(): DesktopVaultRuntimeContext | null {
  return (globalThis as GlobalWithDesktopVaultRuntimeContextGetter)[DESKTOP_VAULT_CONTEXT_GETTER_KEY]?.() ?? null
}
