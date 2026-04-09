import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'path'

import { DESKTOP_DATABASE_FILE_NAME } from '@desktop/vault-layout-constants'

import {
  setDesktopVaultRuntimeContextGetter,
  type DesktopVaultRuntimeContext,
} from '@/lib/runtime/desktop/context-store'

const desktopVaultRuntimeContext = new AsyncLocalStorage<DesktopVaultRuntimeContext>()

setDesktopVaultRuntimeContextGetter(() => desktopVaultRuntimeContext.getStore() ?? null)

export function runWithDesktopVaultContext<T>(vaultRoot: string, callback: () => Promise<T>): Promise<T> {
  return desktopVaultRuntimeContext.run(
    {
      databaseUrl: `file:${join(vaultRoot, DESKTOP_DATABASE_FILE_NAME)}`,
      vaultRoot,
    },
    callback,
  )
}
