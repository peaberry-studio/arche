import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('current desktop vault helpers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_PLATFORM: 'darwin',
      ARCHE_DESKTOP_WEB_HOST: '127.0.0.1',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns null when no vault is active', async () => {
    const { getCurrentDesktopVault } = await import('../desktop/current-vault')

    expect(getCurrentDesktopVault()).toBeNull()
  })

  it('returns current vault metadata and scopes persistence by vault id', async () => {
    process.env.ARCHE_DESKTOP_VAULT_ID = 'vault-1'
    process.env.ARCHE_DESKTOP_VAULT_NAME = 'Arche'
    process.env.ARCHE_DESKTOP_VAULT_PATH = '/tmp/Arche'

    const { getCurrentDesktopVault, getWorkspacePersistenceScope } = await import('../desktop/current-vault')

    expect(getCurrentDesktopVault()).toEqual({
      vaultId: 'vault-1',
      vaultName: 'Arche',
      vaultPath: '/tmp/Arche',
    })
    expect(getWorkspacePersistenceScope('local')).toBe('vault:vault-1')
  })

  it('validates desktop settings sections', async () => {
    const { isDesktopSettingsSection } = await import('../desktop/current-vault')

    expect(isDesktopSettingsSection('providers')).toBe(true)
    expect(isDesktopSettingsSection('connectors')).toBe(true)
    expect(isDesktopSettingsSection('agents')).toBe(true)
    expect(isDesktopSettingsSection('skills')).toBe(true)
    expect(isDesktopSettingsSection('appearance')).toBe(true)
    expect(isDesktopSettingsSection('advanced')).toBe(true)
    expect(isDesktopSettingsSection('security')).toBe(false)
  })
})
