import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    instance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// Mock auth
vi.mock('@/lib/auth', () => ({
  auditEvent: vi.fn(),
}))

// Mock opencode client
vi.mock('@/lib/opencode/client', () => ({
  isInstanceHealthyWithPassword: vi.fn(),
}))

// Mock docker
vi.mock('../docker', () => ({
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
  isContainerRunning: vi.fn(),
}))

// Mock crypto
vi.mock('../crypto', () => ({
  generatePassword: vi.fn(() => 'test-password-123'),
  encryptPassword: vi.fn(() => 'iv:tag:encrypted'),
  decryptPassword: vi.fn(() => 'test-password-123'),
}))

import { prisma } from '@/lib/prisma'
import { auditEvent } from '@/lib/auth'
import { isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import * as docker from '../docker'
import { startInstance, stopInstance, getInstanceStatus, isSlowStart } from '../core'

const mockPrisma = vi.mocked(prisma)
const mockDocker = vi.mocked(docker)
const mockAudit = vi.mocked(auditEvent)
const mockHealth = vi.mocked(isInstanceHealthyWithPassword)

beforeEach(() => {
  vi.clearAllMocks()
  mockHealth.mockResolvedValue(true)
})

describe('startInstance', () => {
  it('returns already_running if instance is running', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue({
      id: '1', slug: 'alice', status: 'running',
      containerId: 'abc', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(),
    })

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'already_running' })
    expect(mockDocker.createContainer).not.toHaveBeenCalled()
  })

  it('creates container and starts it when no existing instance', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(null)
    mockPrisma.instance.upsert.mockResolvedValue({} as never)
    mockPrisma.instance.update.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'running' })
    expect(mockDocker.createContainer).toHaveBeenCalledWith('alice', 'test-password-123')
    expect(mockDocker.startContainer).toHaveBeenCalledWith('container-123')
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'instance.started',
      metadata: { slug: 'alice' },
    })
  })

  it('returns timeout when container never becomes healthy', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(null)
    mockPrisma.instance.upsert.mockResolvedValue({} as never)
    mockPrisma.instance.update.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(false)
    mockHealth.mockResolvedValue(false)
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)

    // Override timeout to be very short for test
    vi.stubEnv('ARCHE_START_TIMEOUT_MS', '100')

    const result = await startInstance('alice', 'user-1')

    expect(result).toMatchObject({ ok: false, error: 'timeout' })
    vi.unstubAllEnvs()
  })

  it('returns start_failed on docker error', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(null)
    mockPrisma.instance.upsert.mockResolvedValue({} as never)
    mockPrisma.instance.update.mockResolvedValue({} as never)
    mockDocker.createContainer.mockRejectedValue(new Error('Docker unavailable'))

    const result = await startInstance('alice', 'user-1')

    expect(result).toMatchObject({ ok: false, error: 'start_failed' })
  })
})

describe('stopInstance', () => {
  it('returns not_running if instance does not exist', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(null)

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'not_running' })
  })

  it('returns not_running if instance already stopped', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue({
      id: '1', slug: 'alice', status: 'stopped',
      containerId: null, serverPassword: 'enc',
      createdAt: new Date(), startedAt: null,
      stoppedAt: new Date(), lastActivityAt: null,
    })

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'not_running' })
  })

  it('stops and removes container when running', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue({
      id: '1', slug: 'alice', status: 'running',
      containerId: 'abc-123', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(),
    })
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockPrisma.instance.update.mockResolvedValue({} as never)

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'stopped' })
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('abc-123')
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('abc-123')
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'instance.stopped',
      metadata: { slug: 'alice' },
    })
  })
})

describe('getInstanceStatus', () => {
  it('returns instance status fields', async () => {
    const now = new Date()
    mockPrisma.instance.findUnique.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
    } as never)
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockHealth.mockResolvedValue(true)

    const result = await getInstanceStatus('alice')

    expect(result).toEqual({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
    })
  })

  it('returns null for non-existent instance', async () => {
    mockPrisma.instance.findUnique.mockResolvedValue(null)

    const result = await getInstanceStatus('unknown')

    expect(result).toBeNull()
  })
})

describe('isSlowStart', () => {
  it('returns false if instance is not starting', () => {
    expect(isSlowStart({ status: 'running', startedAt: new Date() })).toBe(false)
  })

  it('returns false if no startedAt', () => {
    expect(isSlowStart({ status: 'starting', startedAt: null })).toBe(false)
  })

  it('returns false if null', () => {
    expect(isSlowStart(null)).toBe(false)
  })

  it('returns true if starting and elapsed > expected', () => {
    const old = new Date(Date.now() - 20_000) // 20s ago
    expect(isSlowStart({ status: 'starting', startedAt: old })).toBe(true)
  })

  it('returns false if starting but within expected time', () => {
    const recent = new Date(Date.now() - 1_000) // 1s ago
    expect(isSlowStart({ status: 'starting', startedAt: recent })).toBe(false)
  })
})
