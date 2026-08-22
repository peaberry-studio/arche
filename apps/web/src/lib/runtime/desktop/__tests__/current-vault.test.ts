import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsDesktop = vi.hoisted(() => vi.fn())
const mockGetRuntimeMode = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => mockIsDesktop(),
  getRuntimeMode: () => mockGetRuntimeMode(),
}))

import {
  getCurrentDesktopVault,
  getDesktopFlowsHref,
  getWorkspacePersistenceScope,
  isDesktopFlowsView,
  DESKTOP_FLOWS_VIEWS,
} from '../current-vault'

describe('current-vault', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('DESKTOP_FLOWS_VIEWS', () => {
    it('contains expected views', () => {
      expect(DESKTOP_FLOWS_VIEWS).toEqual(['list', 'new', 'edit', 'runs'])
    })
  })

  describe('getCurrentDesktopVault', () => {
    it('returns null when not in desktop mode', () => {
      mockIsDesktop.mockReturnValue(false)
      expect(getCurrentDesktopVault()).toBeNull()
    })

    it('returns null when vault env vars are missing', () => {
      mockIsDesktop.mockReturnValue(true)
      delete process.env.ARCHE_DESKTOP_VAULT_ID
      delete process.env.ARCHE_DESKTOP_VAULT_NAME
      delete process.env.ARCHE_DESKTOP_VAULT_PATH
      expect(getCurrentDesktopVault()).toBeNull()
    })

    it('trims whitespace from env values', () => {
      mockIsDesktop.mockReturnValue(true)
      process.env.ARCHE_DESKTOP_VAULT_ID = '  vault-1  '
      process.env.ARCHE_DESKTOP_VAULT_NAME = '  Arche  '
      process.env.ARCHE_DESKTOP_VAULT_PATH = '  /tmp/Arche  '

      expect(getCurrentDesktopVault()).toEqual({
        vaultId: 'vault-1',
        vaultName: 'Arche',
        vaultPath: '/tmp/Arche',
      })
    })

    it('returns null when only some env vars are set', () => {
      mockIsDesktop.mockReturnValue(true)
      process.env.ARCHE_DESKTOP_VAULT_ID = 'vault-1'
      process.env.ARCHE_DESKTOP_VAULT_NAME = 'Arche'
      delete process.env.ARCHE_DESKTOP_VAULT_PATH

      expect(getCurrentDesktopVault()).toBeNull()
    })

    it('returns null for empty string values after trimming', () => {
      mockIsDesktop.mockReturnValue(true)
      process.env.ARCHE_DESKTOP_VAULT_ID = 'vault-1'
      process.env.ARCHE_DESKTOP_VAULT_NAME = '   '
      process.env.ARCHE_DESKTOP_VAULT_PATH = '/tmp/Arche'

      expect(getCurrentDesktopVault()).toBeNull()
    })
  })

  describe('getWorkspacePersistenceScope', () => {
    it('returns slug when not in desktop mode', () => {
      mockIsDesktop.mockReturnValue(false)
      expect(getWorkspacePersistenceScope('alice')).toBe('alice')
    })

    it('returns vault-scoped path when vault is active', () => {
      mockIsDesktop.mockReturnValue(true)
      process.env.ARCHE_DESKTOP_VAULT_ID = 'vault-1'
      process.env.ARCHE_DESKTOP_VAULT_NAME = 'Arche'
      process.env.ARCHE_DESKTOP_VAULT_PATH = '/tmp/Arche'

      expect(getWorkspacePersistenceScope('alice')).toBe('vault:vault-1')
    })

    it('returns slug fallback when vault is partially configured', () => {
      mockIsDesktop.mockReturnValue(true)
      process.env.ARCHE_DESKTOP_VAULT_ID = 'vault-1'
      delete process.env.ARCHE_DESKTOP_VAULT_PATH

      expect(getWorkspacePersistenceScope('alice')).toBe('alice')
    })
  })

  describe('getDesktopFlowsHref', () => {
    it('returns flow dialog list path', () => {
      expect(getDesktopFlowsHref('alice', 'list')).toBe('/w/alice?flows=list')
    })

    it('includes flow id for detail views', () => {
      expect(getDesktopFlowsHref('alice', 'runs', 'flow-1')).toBe('/w/alice?flows=runs&flowId=flow-1')
    })
  })

  describe('isDesktopFlowsView', () => {
    it('accepts known views only', () => {
      expect(isDesktopFlowsView('list')).toBe(true)
      expect(isDesktopFlowsView('settings')).toBe(false)
    })
  })
})
