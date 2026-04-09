import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('runtime paths', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    vi.doUnmock('path')
    process.env = originalEnv
  })

  describe('web mode', () => {
    beforeEach(() => {
      delete process.env.ARCHE_RUNTIME_MODE
    })

    it('does not require desktop path builtins in web mode', async () => {
      vi.doMock('path', () => {
        throw new Error('path builtin should not be loaded in web mode')
      })

      const { getKbConfigRoot } = await import('../paths')

      expect(getKbConfigRoot()).toBe('/kb-config')
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

      expect(getKbConfigRoot()).toBe('/tmp/arche-test/.kb-config')
      expect(getKbContentRoot()).toBe('/tmp/arche-test/.kb-content')
      expect(getUsersBasePath()).toBe('/tmp/arche-test/.users')
      expect(getUserDataPath('local')).toBe('/tmp/arche-test/.users/local')
    })

    it('throws when ARCHE_DATA_DIR is unset', async () => {
      delete process.env.ARCHE_DATA_DIR
      const { getKbConfigRoot } = await import('../paths')
      expect(() => getKbConfigRoot()).toThrow(
        'Desktop mode requires ARCHE_DATA_DIR to point at the selected vault root',
      )
    })

    it('uses windows separators when desktop platform is win32', async () => {
      process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
      process.env.ARCHE_DATA_DIR = 'C:\\Arche'
      const { getKbConfigRoot, getKbContentRoot, getUsersBasePath, getUserDataPath } =
        await import('../paths')

      expect(getKbConfigRoot()).toBe('C:\\Arche\\.kb-config')
      expect(getKbContentRoot()).toBe('C:\\Arche\\.kb-content')
      expect(getUsersBasePath()).toBe('C:\\Arche\\.users')
      expect(getUserDataPath('local')).toBe('C:\\Arche\\.users\\local')
    })

    it('preserves UNC roots on win32', async () => {
      process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
      process.env.ARCHE_DATA_DIR = '\\\\server\\share\\Arche'
      const { getKbConfigRoot, getUserDataPath } = await import('../paths')

      expect(getKbConfigRoot()).toBe('\\\\server\\share\\Arche\\.kb-config')
      expect(getUserDataPath('local')).toBe('\\\\server\\share\\Arche\\.users\\local')
    })

    it('preserves extended-length windows roots on win32', async () => {
      process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
      process.env.ARCHE_DATA_DIR = '\\\\?\\C:\\Arche'
      const { getKbConfigRoot, getUserDataPath } = await import('../paths')

      expect(getKbConfigRoot()).toBe('\\\\?\\C:\\Arche\\.kb-config')
      expect(getUserDataPath('local')).toBe('\\\\?\\C:\\Arche\\.users\\local')
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
