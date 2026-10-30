import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/harness/legacy-session-archive', () => ({
  preArchiveRunningV1Instances: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    claimIdleStopTransition: vi.fn(),
    findIdleInstances: vi.fn(),
    finishStoppingTransition: vi.fn(),
    recoverStoppingTransition: vi.fn().mockResolvedValue({ count: 1 }),
  },
  auditService: {
    createEvent: vi.fn(),
  },
  messageRunService: {
    reapStaleRuns: vi.fn(),
  },
  rateLimitService: {
    deleteExpiredRateLimitBuckets: vi.fn(),
  },
}))

vi.mock('../docker', () => ({
  hasLegacyBackendWriters: vi.fn().mockResolvedValue(false),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
}))

const readHostMemory = vi.hoisted(() => vi.fn())
vi.mock('@/lib/spawner/host-resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/spawner/host-resources')>()),
  readHostMemory,
}))

import { preArchiveRunningV1Instances } from '@/lib/harness/legacy-session-archive'
import { auditService, instanceService, messageRunService, rateLimitService } from '@/lib/services'
import type { InstanceRecord } from '@/lib/services/instance'
import * as docker from '../docker'
import { getReaperStatus, MAX_REAPED_INSTANCES_PER_CYCLE, reapExpiredRateLimitBuckets, reapIdleInstances, reapStaleMessageRuns, REAPER_INTERVAL_MS, startReaper, stopReaper } from '../reaper'

const GIB = 1024 * 1024 * 1024
// 1 GiB of 16 GiB available (6%): below the default 15% floor.
const LOW_MEMORY = { availableBytes: GIB, totalBytes: 16 * GIB, source: 'meminfo' as const }
const HEALTHY_MEMORY = { availableBytes: 8 * GIB, totalBytes: 16 * GIB, source: 'meminfo' as const }

const mockInstance = vi.mocked(instanceService)
const mockMessageRun = vi.mocked(messageRunService)
const mockRateLimit = vi.mocked(rateLimitService)
const mockDocker = vi.mocked(docker)

const idleCandidate: InstanceRecord = {
  id: 'inst-1', slug: 'alice', status: 'running', containerId: 'old-container', serverPassword: 'enc',
  createdAt: new Date('2026-10-20T09:00:00.000Z'), startedAt: new Date('2026-10-20T09:00:00.000Z'),
  stoppedAt: null, lastActivityAt: new Date('2026-10-20T10:00:00.000Z'),
  appliedConfigSha: null, runtimeKind: 'opencode-v1', providerSyncHash: null, providerSyncedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockMessageRun.reapStaleRuns.mockResolvedValue(0)
  mockRateLimit.deleteExpiredRateLimitBuckets.mockResolvedValue({ count: 0 })
  mockInstance.claimIdleStopTransition.mockResolvedValue({ count: 1 })
  mockInstance.finishStoppingTransition.mockResolvedValue({ count: 1 })
  readHostMemory.mockResolvedValue(LOW_MEMORY)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'))
})

afterEach(() => {
  stopReaper()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('reapIdleInstances', () => {
  it.each([
    { label: 'fresh migration claim', change: { status: 'starting' as const, startedAt: new Date('2026-10-20T11:59:59.000Z') } },
    { label: 'replacement container', change: { containerId: 'new-container' } },
    { label: 'newer start attempt', change: { startedAt: new Date('2026-10-20T11:59:59.000Z') } },
  ])('does not tear down a stale candidate after a $label', async ({ change }) => {
    const current = { ...idleCandidate, ...change }
    mockInstance.findIdleInstances.mockResolvedValue([idleCandidate])
    mockInstance.claimIdleStopTransition.mockImplementation(async (candidate) => ({
      count: current.status === candidate.status && current.containerId === candidate.containerId &&
        current.startedAt?.getTime() === candidate.startedAt?.getTime() ? 1 : 0,
    }))

    expect(await reapIdleInstances()).toBe(0)
    expect(mockInstance.claimIdleStopTransition).toHaveBeenCalledWith(idleCandidate, new Date('2026-10-20T12:00:00.000Z'))
    expect(mockDocker.stopContainer).not.toHaveBeenCalled()
    expect(mockDocker.removeContainer).not.toHaveBeenCalled()
    expect(mockInstance.finishStoppingTransition).not.toHaveBeenCalled()
    expect(auditService.createEvent).not.toHaveBeenCalled()
    expect(current).toEqual({ ...idleCandidate, ...change })
  })

  it('does not audit or count a teardown when completion ownership is lost', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([idleCandidate])
    mockInstance.finishStoppingTransition.mockResolvedValueOnce({ count: 0 })
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)

    expect(await reapIdleInstances()).toBe(0)
    expect(mockDocker.stopContainer).toHaveBeenCalledExactlyOnceWith('old-container')
    expect(mockDocker.removeContainer).toHaveBeenCalledExactlyOnceWith('old-container')
    expect(mockInstance.finishStoppingTransition).toHaveBeenCalledWith(idleCandidate.id, mockInstance.claimIdleStopTransition.mock.calls[0][1])
    expect(auditService.createEvent).not.toHaveBeenCalled()
  })

  it('continues with other idle candidates after losing a claim', async () => {
    const second = { ...idleCandidate, id: 'inst-2', slug: 'bob', containerId: 'bob-container' }
    mockInstance.findIdleInstances.mockResolvedValue([idleCandidate, second])
    mockInstance.claimIdleStopTransition.mockResolvedValueOnce({ count: 0 })
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)

    expect(await reapIdleInstances()).toBe(1)
    expect(mockDocker.stopContainer).toHaveBeenCalledExactlyOnceWith('bob-container')
    expect(mockInstance.finishStoppingTransition).toHaveBeenCalledExactlyOnceWith(second.id, new Date('2026-10-20T12:00:00.000Z'))
    expect(auditService.createEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ metadata: expect.objectContaining({ slug: 'bob' }) }))
  })

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
    mockInstance.finishStoppingTransition.mockResolvedValue({ count: 1 })

    const count = await reapIdleInstances()

    expect(count).toBe(1)
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('container-abc')
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('container-abc')
    const token = new Date('2026-10-20T12:00:00.000Z')
    expect(mockInstance.claimIdleStopTransition).toHaveBeenCalledWith(idleInstance, token)
    expect(mockInstance.claimIdleStopTransition.mock.invocationCallOrder[0]).toBeLessThan(mockDocker.stopContainer.mock.invocationCallOrder[0])
    expect(mockInstance.finishStoppingTransition).toHaveBeenCalledWith('inst-1', token)
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
    mockInstance.finishStoppingTransition.mockResolvedValue({ count: 1 })

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
    mockInstance.finishStoppingTransition
      .mockRejectedValueOnce(new Error('db fail'))
      .mockResolvedValueOnce({ count: 1 })

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
    mockInstance.finishStoppingTransition.mockResolvedValue({ count: 1 })

    const count = await reapIdleInstances()

    expect(count).toBe(1)
    expect(mockDocker.stopContainer).not.toHaveBeenCalled()
  })
})

describe('reapIdleInstances under the memory pressure policy', () => {
  const candidate = (slug: string, idleHours: number): InstanceRecord => ({
    ...idleCandidate,
    id: `inst-${slug}`,
    slug,
    containerId: `${slug}-container`,
    lastActivityAt: new Date(Date.now() - idleHours * 60 * 60 * 1000),
  })

  beforeEach(() => {
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps every instance running while the host has memory to spare', async () => {
    readHostMemory.mockResolvedValue(HEALTHY_MEMORY)

    expect(await reapIdleInstances()).toBe(0)
    expect(mockInstance.findIdleInstances).not.toHaveBeenCalled()
    expect(mockDocker.stopContainer).not.toHaveBeenCalled()
  })

  it('only considers instances idle for at least the configured minimum', async () => {
    vi.stubEnv('ARCHE_IDLE_TIMEOUT_MINUTES', '120')
    mockInstance.findIdleInstances.mockResolvedValue([])

    expect(await reapIdleInstances()).toBe(0)
    expect(mockInstance.findIdleInstances).toHaveBeenCalledWith(new Date('2026-10-20T10:00:00.000Z'))
    expect(console.warn).toHaveBeenCalledWith(
      '[reaper] Host memory is low but no instance has been idle long enough to stop',
      { availableMb: 1024, totalMb: 16384, minIdleMinutes: 120 },
    )
  })

  it('stops the longest idle instance first and stops once memory recovers', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([candidate('oldest', 9), candidate('older', 5), candidate('recent', 3)])
    readHostMemory.mockResolvedValueOnce(LOW_MEMORY).mockResolvedValueOnce(LOW_MEMORY).mockResolvedValueOnce(HEALTHY_MEMORY)

    expect(await reapIdleInstances()).toBe(1)
    expect(mockDocker.stopContainer).toHaveBeenCalledExactlyOnceWith('oldest-container')
    expect(auditService.createEvent).toHaveBeenCalledExactlyOnceWith({
      actorUserId: null,
      action: 'instance.reaped_idle',
      metadata: expect.objectContaining({ slug: 'oldest', reason: 'memory_pressure', idleMinutes: 540, availableMb: 1024, totalMb: 16384 }),
    })
  })

  it('keeps stopping while the pressure lasts, up to the per-cycle cap', async () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'].map((slug, index) => candidate(slug, 10 - index))
    mockInstance.findIdleInstances.mockResolvedValue(candidates)

    expect(await reapIdleInstances()).toBe(MAX_REAPED_INSTANCES_PER_CYCLE)
    expect(mockDocker.stopContainer.mock.calls.map(([id]) => id)).toEqual(['a-container', 'b-container', 'c-container'])
    // One initial measurement, then one confirmation per claim and one after each stop.
    expect(readHostMemory).toHaveBeenCalledTimes(1 + 2 * MAX_REAPED_INSTANCES_PER_CYCLE)
  })

  it('releases a claimed instance and stops reaping when memory recovered before its stop', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([candidate('oldest', 9), candidate('older', 5)])
    readHostMemory.mockResolvedValueOnce(LOW_MEMORY).mockResolvedValueOnce(HEALTHY_MEMORY)

    expect(await reapIdleInstances()).toBe(0)
    expect(mockInstance.claimIdleStopTransition).toHaveBeenCalledOnce()
    expect(mockInstance.recoverStoppingTransition).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ slug: 'oldest' }),
      mockInstance.claimIdleStopTransition.mock.calls[0][1],
    )
    expect(mockDocker.stopContainer).not.toHaveBeenCalled()
    expect(mockInstance.finishStoppingTransition).not.toHaveBeenCalled()
  })

  it('applies the optional absolute floor even when the percentage looks healthy', async () => {
    vi.stubEnv('ARCHE_REAPER_MIN_AVAILABLE_MEMORY_MB', '10240')
    readHostMemory.mockResolvedValue(HEALTHY_MEMORY)
    mockInstance.findIdleInstances.mockResolvedValue([candidate('oldest', 9)])

    expect(await reapIdleInstances()).toBe(1)
  })

  it('does not re-measure or count an instance it could not stop', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([candidate('busy', 9), candidate('next', 4)])
    mockInstance.claimIdleStopTransition.mockResolvedValueOnce({ count: 0 })
    readHostMemory.mockResolvedValueOnce(LOW_MEMORY).mockResolvedValueOnce(LOW_MEMORY).mockResolvedValueOnce(HEALTHY_MEMORY)

    expect(await reapIdleInstances()).toBe(1)
    expect(mockDocker.stopContainer).toHaveBeenCalledExactlyOnceWith('next-container')
  })
})

describe('reapStaleMessageRuns', () => {
  it('delegates to the message run service', async () => {
    mockMessageRun.reapStaleRuns.mockResolvedValue(2)

    await expect(reapStaleMessageRuns()).resolves.toBe(2)
  })
})

describe('reapExpiredRateLimitBuckets', () => {
  it('delegates to the rate limit service', async () => {
    mockRateLimit.deleteExpiredRateLimitBuckets.mockResolvedValue({ count: 3 })

    await expect(reapExpiredRateLimitBuckets()).resolves.toBe(3)
  })
})

describe('startReaper / stopReaper', () => {
  it('starts pre-archive alongside reaping without waiting for the export', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])
    let finish: ((value: number) => void) | undefined
    vi.mocked(preArchiveRunningV1Instances).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))

    startReaper()
    await vi.waitFor(() => expect(preArchiveRunningV1Instances).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(getReaperStatus().lastRunFinishedAt).toBeInstanceOf(Date))
    finish!(0)
  })

  it.each(['legacy', 'inventory'] as const)('keeps pre-archive fenced during an unverified runtime upgrade (%s)', async (reason) => {
    if (reason === 'legacy') mockDocker.hasLegacyBackendWriters.mockResolvedValueOnce(true)
    else mockDocker.hasLegacyBackendWriters.mockRejectedValueOnce(new Error('inventory unavailable'))
    mockInstance.findIdleInstances.mockResolvedValue([])
    startReaper()
    await vi.waitFor(() => expect(mockDocker.hasLegacyBackendWriters).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(getReaperStatus().lastRunFinishedAt).toBeInstanceOf(Date))
    expect(preArchiveRunningV1Instances).not.toHaveBeenCalled()
  })

  it('starts interval that calls reapIdleInstances', async () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    startReaper()

    // Initial call on start
    expect(readHostMemory).toHaveBeenCalledTimes(1)

    stopReaper()
  })

  it('calling startReaper twice does not create duplicate intervals', () => {
    mockInstance.findIdleInstances.mockResolvedValue([])

    startReaper()
    startReaper()

    // Only one initial call
    expect(readHostMemory).toHaveBeenCalledTimes(1)

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
    await vi.waitFor(() => expect(getReaperStatus().lastRunFinishedAt).toBeInstanceOf(Date))
    vi.clearAllMocks()
    await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS)

    expect(readHostMemory).toHaveBeenCalledTimes(1)
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
    mockInstance.finishStoppingTransition.mockResolvedValue({ count: 1 })

    startReaper()

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[reaper] Stopped 1 idle instance(s) to relieve memory pressure'))
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
