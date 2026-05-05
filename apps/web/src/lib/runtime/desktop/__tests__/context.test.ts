import { describe, expect, it } from 'vitest'

import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { runWithDesktopVaultContext } from '../context'

describe('runWithDesktopVaultContext', () => {
  it('runs callback with AsyncLocalStorage context', async () => {
    const callbackResult = await runWithDesktopVaultContext('/vault/root', async () => {
      const ctx = getDesktopVaultRuntimeContext()
      return {
        databaseUrl: ctx?.databaseUrl,
        vaultRoot: ctx?.vaultRoot,
      }
    })

    expect(callbackResult.databaseUrl).toBe('file:/vault/root/.arche.db')
    expect(callbackResult.vaultRoot).toBe('/vault/root')
  })

  it('returns the callback result', async () => {
    const result = await runWithDesktopVaultContext('/vault', async () => 'callback-value')
    expect(result).toBe('callback-value')
  })

  it('isolates context between nested calls', async () => {
    const results: {
      outer?: { db?: string; root?: string }
      inner?: { db?: string; root?: string }
    } = {}

    await runWithDesktopVaultContext('/vault1', async () => {
      const outerCtx = getDesktopVaultRuntimeContext()
      results.outer = {
        db: outerCtx?.databaseUrl,
        root: outerCtx?.vaultRoot,
      }
      await runWithDesktopVaultContext('/vault2', async () => {
        const innerCtx = getDesktopVaultRuntimeContext()
        results.inner = {
          db: innerCtx?.databaseUrl,
          root: innerCtx?.vaultRoot,
        }
      })
    })

    expect(results.outer?.db).toBe('file:/vault1/.arche.db')
    expect(results.inner?.db).toBe('file:/vault2/.arche.db')
  })
})
