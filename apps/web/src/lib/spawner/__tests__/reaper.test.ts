import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/services', () => ({
  instanceService: {
    findIdleInstances: vi.fn(),
    setStoppedById: vi.fn(),
  },
  auditService: {
    createEvent: vi.fn(),
  },
}))

vi.mock('../docker', () => ({
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}))

import { instanceService } from '@/lib/services'
import * as docker from '../docker'
import { reapIdleInstances, startReaper, stopReaper } from '../reaper'

const mockInstance = vi.mocked(instanceService)
const mockDocker = vi.mocked(docker)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  stopReaper()
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
})
