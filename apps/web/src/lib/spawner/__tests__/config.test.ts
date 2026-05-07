import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getEncryptionKey', () => {
    it('returns key from env when ARCHE_ENCRYPTION_KEY is set', async () => {
      const keyBytes = Buffer.from('test-key-32-bytes-long-for-aes!!')
      process.env.ARCHE_ENCRYPTION_KEY = keyBytes.toString('base64')

      const { getEncryptionKey } = await import('../config')
      const result = getEncryptionKey()

      expect(result).toEqual(keyBytes)
    })

    it('throws in production when ARCHE_ENCRYPTION_KEY is not set', async () => {
      delete process.env.ARCHE_ENCRYPTION_KEY
      process.env.NODE_ENV = 'production'

      const { getEncryptionKey } = await import('../config')

      expect(() => getEncryptionKey()).toThrow('ARCHE_ENCRYPTION_KEY is required in production')
    })

    it('returns dev key in non-production when ARCHE_ENCRYPTION_KEY is not set', async () => {
      delete process.env.ARCHE_ENCRYPTION_KEY
      process.env.NODE_ENV = 'development'

      const { getEncryptionKey } = await import('../config')
      const result = getEncryptionKey()

      expect(result).toEqual(Buffer.from('dev-insecure-key-32-bytes-long!!'))
    })
  })

  describe('getContainerProxyUrl', () => {
    it('returns default URL when env vars not set', async () => {
      delete process.env.CONTAINER_PROXY_HOST
      delete process.env.CONTAINER_PROXY_PORT

      const { getContainerProxyUrl } = await import('../config')

      expect(getContainerProxyUrl()).toBe('http://docker-socket-proxy:2375')
    })

    it('uses custom host and port from env', async () => {
      process.env.CONTAINER_PROXY_HOST = 'custom-host'
      process.env.CONTAINER_PROXY_PORT = '1234'

      const { getContainerProxyUrl } = await import('../config')

      expect(getContainerProxyUrl()).toBe('http://custom-host:1234')
    })
  })

  describe('getContainerSocketPath', () => {
    it('returns socket path from CONTAINER_SOCKET_PATH', async () => {
      process.env.CONTAINER_SOCKET_PATH = '/run/podman/podman.sock'

      const { getContainerSocketPath } = await import('../config')

      expect(getContainerSocketPath()).toBe('/run/podman/podman.sock')
    })

    it('returns undefined when CONTAINER_SOCKET_PATH is missing', async () => {
      delete process.env.CONTAINER_SOCKET_PATH

      const { getContainerSocketPath } = await import('../config')

      expect(getContainerSocketPath()).toBeUndefined()
    })

    it('does not use legacy CONTAINER_HOST env var', async () => {
      delete process.env.CONTAINER_SOCKET_PATH
      process.env.CONTAINER_HOST = 'unix:///run/podman/podman.sock'

      const { getContainerSocketPath } = await import('../config')

      expect(getContainerSocketPath()).toBeUndefined()
    })
  })

  describe('getOpencodeImage', () => {
    it('returns default image when OPENCODE_IMAGE not set', async () => {
      delete process.env.OPENCODE_IMAGE

      const { getOpencodeImage } = await import('../config')

      expect(getOpencodeImage()).toBe('ghcr.io/peaberry-studio/arche/workspace:latest')
    })

    it('returns custom image from env', async () => {
      process.env.OPENCODE_IMAGE = 'my-registry/opencode:custom'

      const { getOpencodeImage } = await import('../config')

      expect(getOpencodeImage()).toBe('my-registry/opencode:custom')
    })
  })

  describe('getOpencodeNetwork', () => {
    it('returns default network when OPENCODE_NETWORK not set', async () => {
      delete process.env.OPENCODE_NETWORK

      const { getOpencodeNetwork } = await import('../config')

      expect(getOpencodeNetwork()).toBe('arche-internal')
    })

    it('returns custom network from env', async () => {
      process.env.OPENCODE_NETWORK = 'custom-network'

      const { getOpencodeNetwork } = await import('../config')

      expect(getOpencodeNetwork()).toBe('custom-network')
    })
  })

  describe('getStartExpectedMs', () => {
    it('returns default 15000 when not set', async () => {
      delete process.env.ARCHE_START_EXPECTED_MS

      const { getStartExpectedMs } = await import('../config')

      expect(getStartExpectedMs()).toBe(15_000)
    })

    it('parses custom value from env', async () => {
      process.env.ARCHE_START_EXPECTED_MS = '30000'

      const { getStartExpectedMs } = await import('../config')

      expect(getStartExpectedMs()).toBe(30_000)
    })

    it('returns default for invalid values', async () => {
      process.env.ARCHE_START_EXPECTED_MS = 'invalid'

      const { getStartExpectedMs } = await import('../config')

      expect(getStartExpectedMs()).toBe(15_000)
    })

    it('returns default for zero or negative values', async () => {
      process.env.ARCHE_START_EXPECTED_MS = '0'

      const { getStartExpectedMs } = await import('../config')

      expect(getStartExpectedMs()).toBe(15_000)
    })
  })

  describe('getStartTimeoutMs', () => {
    it('returns default 120000 when not set', async () => {
      delete process.env.ARCHE_START_TIMEOUT_MS

      const { getStartTimeoutMs } = await import('../config')

      expect(getStartTimeoutMs()).toBe(120_000)
    })

    it('parses custom value from env', async () => {
      process.env.ARCHE_START_TIMEOUT_MS = '60000'

      const { getStartTimeoutMs } = await import('../config')

      expect(getStartTimeoutMs()).toBe(60_000)
    })
  })

  describe('getIdleTimeoutMinutes', () => {
    it('returns default 120 when not set', async () => {
      delete process.env.ARCHE_IDLE_TIMEOUT_MINUTES

      const { getIdleTimeoutMinutes } = await import('../config')

      expect(getIdleTimeoutMinutes()).toBe(120)
    })

    it('parses custom value from env', async () => {
      process.env.ARCHE_IDLE_TIMEOUT_MINUTES = '60'

      const { getIdleTimeoutMinutes } = await import('../config')

      expect(getIdleTimeoutMinutes()).toBe(60)
    })

    it('floors decimal values', async () => {
      process.env.ARCHE_IDLE_TIMEOUT_MINUTES = '45.7'

      const { getIdleTimeoutMinutes } = await import('../config')

      expect(getIdleTimeoutMinutes()).toBe(45)
    })
  })

  describe('getKbContentHostPath', () => {
    it('throws when KB_CONTENT_HOST_PATH is missing', async () => {
      delete process.env.KB_CONTENT_HOST_PATH

      const { getKbContentHostPath } = await import('../config')

      expect(() => getKbContentHostPath()).toThrow('KB_CONTENT_HOST_PATH is required')
    })

    it('returns trimmed KB_CONTENT_HOST_PATH', async () => {
      process.env.KB_CONTENT_HOST_PATH = '  /opt/arche/kb-content  '

      const { getKbContentHostPath } = await import('../config')

      expect(getKbContentHostPath()).toBe('/opt/arche/kb-content')
    })
  })
})
