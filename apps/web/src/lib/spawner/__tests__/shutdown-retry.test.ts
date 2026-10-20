import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auditService } from '@/lib/services'
import type { InstanceRecord } from '@/lib/services/instance'
import { stopInstance } from '@/lib/spawner/core'
import * as docker from '@/lib/spawner/docker'
import { reapIdleInstances } from '@/lib/spawner/reaper'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { instance: mocks } }))
vi.mock('@/lib/services', async () => ({
  instanceService: await import('@/lib/services/instance'),
  auditService: { createEvent: vi.fn() },
  messageRunService: {}, rateLimitService: {}, providerService: {}, userService: {},
}))
vi.mock('@/lib/harness/registry', () => ({}))
vi.mock('@/lib/harness/execution', () => ({}))
vi.mock('@/lib/harness/legacy-session-archive', () => ({}))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({}))
vi.mock('@/lib/spawner/docker', () => ({ stopContainer: vi.fn(), removeContainer: vi.fn() }))

let current: InstanceRecord

beforeEach(() => {
  vi.clearAllMocks()
  current = {
    id: 'instance', slug: 'alice', status: 'running', containerId: 'source', runtimeKind: 'opencode-v1',
    createdAt: new Date(0), startedAt: new Date(1), stoppedAt: null, lastActivityAt: new Date(2),
    serverPassword: 'encrypted-fixture', appliedConfigSha: 'hash', providerSyncHash: 'provider-hash', providerSyncedAt: new Date(3),
  }
  mocks.findUnique.mockImplementation(async () => ({ ...current }))
  mocks.findMany.mockImplementation(async () => current.status === 'running' ? [{ ...current }] : [])
  mocks.updateMany.mockImplementation(async ({ where, data }: { where: Partial<InstanceRecord>; data: Partial<InstanceRecord> }) => {
    const keys: (keyof InstanceRecord)[] = ['id', 'status', 'containerId', 'startedAt']
    const matches = keys.every((key) => {
      const value = where[key]
      if (value === undefined) return true
      const actual = current[key]
      return value instanceof Date && actual instanceof Date ? value.getTime() === actual.getTime() : value === actual
    })
    if (!matches) return { count: 0 }
    current = { ...current, ...data }
    return { count: 1 }
  })
  vi.mocked(docker.stopContainer).mockRejectedValueOnce(new Error('stop failed')).mockResolvedValue(undefined)
  vi.mocked(docker.removeContainer).mockRejectedValueOnce(new Error('removal failed')).mockResolvedValue(undefined)
})

describe.each([
  { name: 'web stop', invoke: () => stopInstance('alice', 'owner'), failed: { ok: false, error: 'stop_failed' }, succeeded: { ok: true, status: 'stopped' } },
  { name: 'idle reaper', invoke: () => reapIdleInstances(), failed: 0, succeeded: 1 },
])('$name shutdown ownership', ({ invoke, failed, succeeded }) => {
  it('retains source identity after failure and allows an immediate successful retry through the real service transitions', async () => {
    const original = { ...current }
    expect(await invoke()).toEqual(failed)
    expect(current).toEqual(original)
    expect(auditService.createEvent).not.toHaveBeenCalled()

    expect(await invoke()).toEqual(succeeded)
    expect(current).toMatchObject({ status: 'stopped', containerId: null, providerSyncHash: null })
    expect(docker.stopContainer).toHaveBeenNthCalledWith(2, 'source')
    expect(docker.removeContainer).toHaveBeenNthCalledWith(2, 'source')
    expect(auditService.createEvent).toHaveBeenCalledOnce()
  })

  it.each(['container', 'attempt', 'status'])('does not recover over a superseding %s', async (change) => {
    vi.mocked(docker.removeContainer).mockReset().mockImplementation(async () => {
      if (change === 'container') current = { ...current, containerId: 'replacement' }
      if (change === 'attempt') current = { ...current, startedAt: new Date(Date.now() + 1000) }
      if (change === 'status') current = { ...current, status: 'running' }
      throw new Error('removal failed')
    })
    expect(await invoke()).toEqual(failed)
    expect(current.status).toBe(change === 'status' ? 'running' : 'starting')
    expect(current.containerId).toBe(change === 'container' ? 'replacement' : 'source')
    expect(auditService.createEvent).not.toHaveBeenCalled()
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'instance', status: 'starting', containerId: 'source', startedAt: expect.any(Date) },
      data: { status: 'running', startedAt: new Date(1) },
    })
  })
})
