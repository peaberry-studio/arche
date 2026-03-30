import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('runtime paths', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('web mode', () => {
    beforeEach(() => {
      delete process.env.ARCHE_RUNTIME_MODE
    })

    it('returns /kb-config for kbConfigRoot', async () => {
      const { getKbConfigRoot } = await import('../paths')
      expect(getKbConfigRoot()).toBe('/kb-config')
    })

    it('returns /kb-content for kbContentRoot', async () => {
      const { getKbContentRoot } = await import('../paths')
      expect(getKbContentRoot()).toBe('/kb-content')
    })

    it('returns default /opt/arche/users for usersBasePath', async () => {
      delete process.env.ARCHE_USERS_PATH
      const { getUsersBasePath } = await import('../paths')
      expect(getUsersBasePath()).toBe('/opt/arche/users')
    })

    it('respects ARCHE_USERS_PATH override', async () => {
      process.env.ARCHE_USERS_PATH = '/custom/users'
      const { getUsersBasePath } = await import('../paths')
      expect(getUsersBasePath()).toBe('/custom/users')
    })

    it('returns user data path under users base', async () => {
      delete process.env.ARCHE_USERS_PATH
      const { getUserDataPath } = await import('../paths')
      expect(getUserDataPath('alice')).toBe('/opt/arche/users/alice')
    })

    it('rejects directory traversal slugs', async () => {
      const { getUserDataPath } = await import('../paths')
      expect(() => getUserDataPath('../etc')).toThrow()
      expect(() => getUserDataPath('foo/../../bar')).toThrow()
      expect(() => getUserDataPath('foo\\bar')).toThrow()
    })
  })

  describe('desktop mode', () => {
    beforeEach(() => {
      process.env.ARCHE_RUNTIME_MODE = 'desktop'
      process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
      process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    })

    it('returns paths under ARCHE_DATA_DIR when set', async () => {
      process.env.ARCHE_DATA_DIR = '/tmp/arche-test'
      const { getKbConfigRoot, getKbContentRoot, getUsersBasePath, getUserDataPath } =
        await import('../paths')

      expect(getKbConfigRoot()).toBe('/tmp/arche-test/kb-config')
      expect(getKbContentRoot()).toBe('/tmp/arche-test/kb-content')
      expect(getUsersBasePath()).toBe('/tmp/arche-test/users')
      expect(getUserDataPath('local')).toBe('/tmp/arche-test/users/local')
    })

    it('falls back to HOME/.arche when ARCHE_DATA_DIR is unset', async () => {
      delete process.env.ARCHE_DATA_DIR
      process.env.HOME = '/Users/testuser'
      const { getKbConfigRoot } = await import('../paths')
      expect(getKbConfigRoot()).toBe('/Users/testuser/.arche/kb-config')
    })

    it('rejects directory traversal slugs', async () => {
      process.env.ARCHE_DATA_DIR = '/tmp/arche-test'
      const { getUserDataPath } = await import('../paths')
      expect(() => getUserDataPath('../etc')).toThrow()
      expect(() => getUserDataPath('foo/../../bar')).toThrow()
      expect(() => getUserDataPath('foo\\bar')).toThrow()
    })
  })
})
