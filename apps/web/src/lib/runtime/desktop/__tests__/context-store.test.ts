import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  setDesktopVaultRuntimeContextGetter,
  getDesktopVaultRuntimeContext,
} from '../context-store'

describe('context-store', () => {
  const symbolKey = Symbol.for('arche.desktop-vault-context-getter')

  beforeEach(() => {
    // Clean up the global symbol before each test
    delete (globalThis as Record<symbol, unknown>)[symbolKey]
  })

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[symbolKey]
  })

  it('returns null when no getter is set', () => {
    expect(getDesktopVaultRuntimeContext()).toBeNull()
  })

  it('returns context from the getter when set', () => {
    const mockContext = {
      databaseUrl: 'postgres://localhost:5432/test',
      vaultRoot: '/tmp/vault',
    }

    setDesktopVaultRuntimeContextGetter(() => mockContext)

    expect(getDesktopVaultRuntimeContext()).toBe(mockContext)
  })

  it('returns null when getter returns null', () => {
    setDesktopVaultRuntimeContextGetter(() => null)

    expect(getDesktopVaultRuntimeContext()).toBeNull()
  })

  it('overwrites a previously set getter', () => {
    const contextA = { databaseUrl: 'a', vaultRoot: '/a' }
    const contextB = { databaseUrl: 'b', vaultRoot: '/b' }

    setDesktopVaultRuntimeContextGetter(() => contextA)
    expect(getDesktopVaultRuntimeContext()).toBe(contextA)

    setDesktopVaultRuntimeContextGetter(() => contextB)
    expect(getDesktopVaultRuntimeContext()).toBe(contextB)
  })
})
