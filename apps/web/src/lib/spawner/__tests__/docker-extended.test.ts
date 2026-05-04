import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mockContainer = {
  id: 'container-123',
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn(),
  exec: vi.fn(),
}

const mockDockerInstance = {
  createContainer: vi.fn().mockResolvedValue(mockContainer),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  createVolume: vi.fn().mockResolvedValue({}),
}

const mockDockerConstructor = vi.fn(() => mockDockerInstance)

vi.mock('dockerode', () => ({
  default: mockDockerConstructor,
}))

const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockChmod = vi.fn().mockResolvedValue(undefined)
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockRm = vi.fn().mockResolvedValue(undefined)
vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}))

vi.mock('@/lib/user-data', () => ({
  getUserDataHostPath: vi.fn((slug: string) => `/opt/arche/users/${slug}`),
  ensureUserDirectory: vi.fn().mockResolvedValue('/opt/arche/users/user-slug'),
}))

import {
  createContainer,
  stopContainer,
  removeContainer,
  isContainerRunning,
  isOpencodeHealthy,
  execInContainer,
} from '@/lib/spawner/docker'

describe('docker extended', () => {
  const originalVitest = process.env.VITEST

  beforeEach(() => {
    process.env.VITEST = 'true'
    process.env = { ...process.env }
    delete process.env.CONTAINER_SOCKET_PATH
    process.env.CONTAINER_PROXY_HOST = 'test-proxy'
    process.env.CONTAINER_PROXY_PORT = '2375'
    process.env.OPENCODE_IMAGE = 'test-image:latest'
    process.env.OPENCODE_NETWORK = 'test-network'
    process.env.KB_CONTENT_HOST_PATH = '/opt/arche/kb-content'
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = originalVitest
    }
    vi.clearAllMocks()
  })

  describe('createContainer', () => {
    it('writes AGENTS.md and then removes it when agentsMd is empty', async () => {
      mockRm.mockResolvedValue(undefined)

      await createContainer('user-slug', 'secret-password', undefined, '')

      expect(mockRm).toHaveBeenCalledWith(
        '/opt/arche/users/user-slug/AGENTS.md',
        { force: true }
      )
    })

    it('handles volume creation errors gracefully', async () => {
      mockDockerInstance.createVolume.mockRejectedValue(new Error('already exists'))

      const container = await createContainer('user-slug', 'secret-password')
      expect(container.id).toBe('container-123')
      expect(mockDockerInstance.createVolume).toHaveBeenCalledTimes(3)
    })
  })

  describe('isContainerRunning', () => {
    it('returns false when inspectContainer throws', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('container not found'))
      const running = await isContainerRunning('container-123')
      expect(running).toBe(false)
    })
  })

  describe('isOpencodeHealthy', () => {
    it('returns true when health check returns healthy', async () => {
      const execResult = {
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer) => void) => {
              if (event === 'data') {
                const response = Buffer.from(JSON.stringify({ healthy: true }))
                const header = Buffer.alloc(8)
                header[0] = 1 // stdout
                header.writeUInt32BE(response.length, 4)
                handler(Buffer.concat([header, response]))
              }
              if (event === 'end') {
                setTimeout(() => handler(), 0)
              }
            },
          }
          cb(null, stream)
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      }
      mockContainer.exec.mockResolvedValue(execResult)

      const healthy = await isOpencodeHealthy('container-123')
      expect(healthy).toBe(true)
    })

    it('returns false when health check exit code is non-zero', async () => {
      const execResult = {
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer) => void) => {
              if (event === 'end') {
                setTimeout(() => handler(), 0)
              }
            },
          }
          cb(null, stream)
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 1 }),
      }
      mockContainer.exec.mockResolvedValue(execResult)

      const healthy = await isOpencodeHealthy('container-123')
      expect(healthy).toBe(false)
    })

    it('returns false when exec throws', async () => {
      mockContainer.exec.mockRejectedValue(new Error('exec failed'))

      const healthy = await isOpencodeHealthy('container-123')
      expect(healthy).toBe(false)
    })
  })

  describe('execInContainer', () => {
    it('returns stdout, stderr, and exit code', async () => {
      const execResult = {
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer) => void) => {
              if (event === 'data') {
                const stdoutData = Buffer.from('hello stdout')
                const stdoutHeader = Buffer.alloc(8)
                stdoutHeader[0] = 1
                stdoutHeader.writeUInt32BE(stdoutData.length, 4)

                const stderrData = Buffer.from('hello stderr')
                const stderrHeader = Buffer.alloc(8)
                stderrHeader[0] = 2
                stderrHeader.writeUInt32BE(stderrData.length, 4)

                handler(Buffer.concat([stdoutHeader, stdoutData, stderrHeader, stderrData]))
              }
              if (event === 'end') {
                setTimeout(() => handler(), 0)
              }
            },
          }
          cb(null, stream)
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 42 }),
      }
      mockContainer.exec.mockResolvedValue(execResult)

      const result = await execInContainer('container-123', ['echo', 'test'])
      expect(result.exitCode).toBe(42)
      expect(result.stdout).toBe('hello stdout')
      expect(result.stderr).toBe('hello stderr')
    })

    it('rejects when exec start errors', async () => {
      mockContainer.exec.mockResolvedValue({
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null) => void) => {
          cb(new Error('start failed'))
        }),
      })

      await expect(execInContainer('container-123', ['echo'])).rejects.toThrow('start failed')
    })

    it('rejects when no stream is returned', async () => {
      mockContainer.exec.mockResolvedValue({
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: null) => void) => {
          cb(null, null)
        }),
      })

      await expect(execInContainer('container-123', ['echo'])).rejects.toThrow('No stream returned')
    })

    it('rejects on stream error event', async () => {
      mockContainer.exec.mockResolvedValue({
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer | Error) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer | Error) => void) => {
              if (event === 'error') {
                setTimeout(() => handler(new Error('stream error')), 0)
              }
            },
          }
          cb(null, stream)
        }),
      })

      await expect(execInContainer('container-123', ['echo'])).rejects.toThrow('stream error')
    })

    it('resolves with exit code 0 when inspect throws', async () => {
      const execResult = {
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer) => void) => {
              if (event === 'end') {
                setTimeout(() => handler(), 0)
              }
            },
          }
          cb(null, stream)
        }),
        inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
      }
      mockContainer.exec.mockResolvedValue(execResult)

      const result = await execInContainer('container-123', ['echo'], { timeout: 1000 })
      expect(result.exitCode).toBe(0)
    })

    it('times out long-running exec', async () => {
      mockContainer.exec.mockResolvedValue({
        start: vi.fn().mockImplementation(() => {
          // Never call end – simulates a hung exec
        }),
      })

      await expect(
        execInContainer('container-123', ['sleep', '10'], { timeout: 50 })
      ).rejects.toThrow('Exec timed out after')
    })

    it('uses custom working directory', async () => {
      const execResult = {
        start: vi.fn().mockImplementation((_opts: never, cb: (err: Error | null, stream: { on: (event: string, handler: (data?: Buffer) => void) => void } | null) => void) => {
          const stream = {
            on: (event: string, handler: (data?: Buffer) => void) => {
              if (event === 'end') {
                setTimeout(() => handler(), 0)
              }
            },
          }
          cb(null, stream)
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      }
      mockContainer.exec.mockResolvedValue(execResult)

      await execInContainer('container-123', ['pwd'], { workingDir: '/tmp', timeout: 1000 })
      expect(mockContainer.exec).toHaveBeenCalledWith(
        expect.objectContaining({ WorkingDir: '/tmp' })
      )
    })
  })

  describe('stopContainer', () => {
    it('stops with default timeout', async () => {
      await stopContainer('container-123')
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 })
    })
  })

  describe('removeContainer', () => {
    it('removes with force', async () => {
      await removeContainer('container-123')
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
    })
  })
})
