import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/services', () => ({
  instanceService: {
    findIdleInstances: vi.fn(),
    setStoppedById: vi.fn(),
  },
  auditService: {
    createEvent: vi.fn(),
  },
  messageRunService: {
    reapStaleRuns: vi.fn(),
  },
}))

vi.mock('../docker', () => ({
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}))

import { instanceService, messageRunService } from '@/lib/services'
import * as docker from '../docker'
import { getReaperStatus, reapIdleInstances, reapStaleMessageRuns, REAPER_INTERVAL_MS, startReaper, stopReaper } from '../reaper'

const mockInstance = vi.mocked(instanceService)
const mockMessageRun = vi.mocked(messageRunService)
const mockDocker = vi.mocked(docker)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockMessageRun.reapStaleRuns.mockResolvedValue(0)
  vi.useFakeTimers()
})

afterEach(() => {
  stopReaper()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('reapIdleInstances', () => {
  it('returns 0 when no idle instances', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    const count = await reapIdleInstances()

    expect(count).toBe(0)
    expect(mockInstance.findIdleInstances).toHaveBeenCalledWith(expect.any(Date))
  })

  it('stops and removes idle instances', async () => {
    const idleInstance = {
      id: 'inst-1',
      slug: 'alice',
      status: 'running' as const,
      containerId: 'container-abc',
      serverPassword: 'enc',
      createdAt: new Date(),
      startedAt: new Date(),
      stoppedAt: null,
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      appliedConfigSha: null,
    }
    mockInstance.findIdleInstances.mockResolvedValue([idleInstance])
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockInstance.setStoppedById.mockResolvedValue({} as never)

    const count = await reapIdleInstances()

    expect(count).toBe(1)
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('container-abc')
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('container-abc')
    expect(mockInstance.setStoppedById).toHaveBeenCalledWith('inst-1')
  })

  it('continues when removing a stopped container fails', async () => {
    const idleInstance = {
      id: 'inst-1',
      slug: 'alice',
      status: 'running' as const,
      containerId: 'container-abc',
      serverPassword: 'enc',
      createdAt: new Date(),
      startedAt: new Date(),
      stoppedAt: null,
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
      appliedConfigSha: null,
    }
    mockInstance.findIdleInstances.mockResolvedValue([idleInstance])
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockRejectedValue(new Error('remove failed'))
    mockInstance.setStoppedById.mockResolvedValue({} as never)

    await expect(reapIdleInstances()).resolves.toBe(1)
    expect(console.warn).toHaveBeenCalledWith(
      '[reaper] Failed to remove container:',
      expect.objectContaining({ containerId: 'container-abc', slug: 'alice' }),
    )
  })

  it('continues reaping other instances if one fails', async () => {
    const instances = [
      {
        id: 'inst-1', slug: 'alice', status: 'running' as const,
        containerId: 'c1', serverPassword: 'enc',
        createdAt: new Date(), startedAt: new Date(),
        stoppedAt: null, lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
        appliedConfigSha: null,
      },
      {
        id: 'inst-2', slug: 'bob', status: 'running' as const,
        containerId: 'c2', serverPassword: 'enc',
        createdAt: new Date(), startedAt: new Date(),
        stoppedAt: null, lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
        appliedConfigSha: null,
      },
    ]
    mockInstance.findIdleInstances.mockResolvedValue(instances)
    mockDocker.stopContainer
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockInstance.setStoppedById
      .mockRejectedValueOnce(new Error('db fail'))
      .mockResolvedValueOnce({} as never)

    const count = await reapIdleInstances()

    // First fails (update throws), second succeeds
    expect(count).toBe(1)
  })

  it('handles instance without containerId', async () => {
    const instance = {
      id: 'inst-1', slug: 'alice', status: 'running' as const,
      containerId: null, serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
      appliedConfigSha: null,
    }
    mockInstance.findIdleInstances.mockResolvedValue([instance])
    mockInstance.setStoppedById.mockResolvedValue({} as never)

    const count = await reapIdleInstances()

    expect(count).toBe(1)
    expect(mockDocker.stopContainer).not.toHaveBeenCalled()
  })
})

describe('reapStaleMessageRuns', () => {
  it('delegates to the message run service', async () => {
    mockMessageRun.reapStaleRuns.mockResolvedValue(2)

    await expect(reapStaleMessageRuns()).resolves.toBe(2)
  })
})

describe('startReaper / stopReaper', () => {
  it('starts interval that calls reapIdleInstances', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    startReaper()

    // Initial call on start
    expect(mockInstance.findIdleInstances).toHaveBeenCalledTimes(1)

    stopReaper()
  })

  it('calling startReaper twice does not create duplicate intervals', () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    startReaper()
    startReaper()

    // Only one initial call
    expect(mockInstance.findIdleInstances).toHaveBeenCalledTimes(1)

    stopReaper()
  })

  it('reports status before start, during execution, and after stop', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    expect(getReaperStatus()).toMatchObject({ running: false })

    startReaper()
    expect(getReaperStatus()).toMatchObject({ running: true, lastRunError: null })

    await vi.waitFor(() => expect(getReaperStatus().lastRunFinishedAt).toBeInstanceOf(Date))

    stopReaper()
    expect(getReaperStatus()).toMatchObject({ running: false })
  })

  it('runs another cycle on the configured interval', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    startReaper()
    vi.clearAllMocks()
    await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS)

    expect(mockInstance.findIdleInstances).toHaveBeenCalledTimes(1)
  })

  it('logs when a cycle stops idle instances', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([
      {
        id: 'inst-1', slug: 'alice', status: 'running' as const,
        containerId: null, serverPassword: 'enc',
        createdAt: new Date(), startedAt: new Date(),
        stoppedAt: null, lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
        appliedConfigSha: null,
      },
    ])
    mockInstance.setStoppedById.mockResolvedValue({} as never)

    startReaper()

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[reaper] Stopped 1 idle instance(s)'))
  })

  it('logs when a cycle fails stale message runs', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])
    mockMessageRun.reapStaleRuns.mockResolvedValue(2)

    startReaper()

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[reaper] Failed 2 stale message run(s)'))
  })

  it('stores and logs cycle errors', async () => {
    mockInstance.findIdleInstances.mockRejectedValue(new Error('db unavailable'))

    startReaper()

    await vi.waitFor(() => expect(getReaperStatus().lastRunError).toBe('db unavailable'))
    expect(console.error).toHaveBeenCalledWith('[reaper] Error:', expect.any(Error))
  })
})
