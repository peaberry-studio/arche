import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encryptPassword: vi.fn((password: string) => `encrypted:${password}`),
  findStatusBySlug: vi.fn(),
  getE2eRuntimeConnection: vi.fn(),
  setRunning: vi.fn(),
  setStopped: vi.fn(),
  upsertStarting: vi.fn(),
}))

vi.mock('@/lib/e2e/runtime', () => ({
  getE2eRuntimeConnection: (...args: unknown[]) => mocks.getE2eRuntimeConnection(...args),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findStatusBySlug: (...args: unknown[]) => mocks.findStatusBySlug(...args),
    setRunning: (...args: unknown[]) => mocks.setRunning(...args),
    setStopped: (...args: unknown[]) => mocks.setStopped(...args),
    upsertStarting: (...args: unknown[]) => mocks.upsertStarting(...args),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  encryptPassword: (...args: [string]) => mocks.encryptPassword(...args),
}))

import { desktopWorkspaceHostE2e } from '@/lib/runtime/workspace-host-desktop-e2e'
import { webWorkspaceHostE2e } from '@/lib/runtime/workspace-host-web-e2e'

const connection = {
  authHeader: 'Basic token',
  baseUrl: 'http://127.0.0.1:4210',
  password: 'runtime-password',
}

const runningInstance = {
  status: 'running' as const,
  startedAt: new Date('2026-05-01T10:00:00.000Z'),
  stoppedAt: null,
  lastActivityAt: new Date('2026-05-01T10:05:00.000Z'),
}

describe('E2E workspace hosts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getE2eRuntimeConnection.mockReturnValue(connection)
    mocks.findStatusBySlug.mockResolvedValue(runningInstance)
    mocks.setRunning.mockResolvedValue(undefined)
    mocks.setStopped.mockResolvedValue(undefined)
    mocks.upsertStarting.mockResolvedValue(undefined)
  })

  it('fails start when the fake runtime connection is missing', async () => {
    mocks.getE2eRuntimeConnection.mockReturnValue(null)

    await expect(webWorkspaceHostE2e.start('alice')).resolves.toEqual({
      ok: false,
      error: 'start_failed',
      detail: 'missing_e2e_runtime_connection',
    })
    await expect(desktopWorkspaceHostE2e.start('alice')).resolves.toEqual({
      ok: false,
      error: 'start_failed',
      detail: 'missing_e2e_runtime_connection',
    })

    expect(mocks.upsertStarting).not.toHaveBeenCalled()
  })

  it('starts web and desktop fake runtimes with their host-specific statuses', async () => {
    await expect(webWorkspaceHostE2e.start('alice')).resolves.toEqual({ ok: true, status: 'running' })
    await expect(desktopWorkspaceHostE2e.start('alice')).resolves.toEqual({ ok: true, status: 'started' })

    expect(mocks.encryptPassword).toHaveBeenCalledWith('runtime-password')
    expect(mocks.upsertStarting).toHaveBeenCalledWith('alice', 'encrypted:runtime-password')
    expect(mocks.setRunning).toHaveBeenCalledWith('alice', null)
  })

  it('stops only active fake runtime instances', async () => {
    await expect(webWorkspaceHostE2e.stop('alice')).resolves.toEqual({ ok: true, status: 'stopped' })
    expect(mocks.setStopped).toHaveBeenCalledWith('alice')

    mocks.findStatusBySlug.mockResolvedValueOnce(null)
    await expect(desktopWorkspaceHostE2e.stop('missing')).resolves.toEqual({ ok: true, status: 'already_stopped' })

    mocks.findStatusBySlug.mockResolvedValueOnce({ ...runningInstance, status: 'stopped' })
    await expect(webWorkspaceHostE2e.stop('stopped')).resolves.toEqual({ ok: true, status: 'already_stopped' })
  })

  it('reports fake runtime status using each host contract', async () => {
    await expect(webWorkspaceHostE2e.getStatus('alice')).resolves.toEqual(runningInstance)
    await expect(desktopWorkspaceHostE2e.getStatus('alice')).resolves.toEqual(runningInstance)

    mocks.findStatusBySlug.mockResolvedValueOnce(null)
    await expect(webWorkspaceHostE2e.getStatus('missing')).resolves.toBeNull()

    mocks.findStatusBySlug.mockResolvedValueOnce(null)
    await expect(desktopWorkspaceHostE2e.getStatus('missing')).resolves.toEqual({
      status: 'stopped',
      startedAt: null,
      stoppedAt: null,
      lastActivityAt: null,
    })
  })

  it('returns fake runtime connections only for running instances', async () => {
    await expect(webWorkspaceHostE2e.getConnection('alice')).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4210',
      authHeader: 'Basic token',
    })
    await expect(desktopWorkspaceHostE2e.getAgentConnection('alice')).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4210',
      authHeader: 'Basic token',
    })

    mocks.findStatusBySlug.mockResolvedValueOnce({ ...runningInstance, status: 'stopped' })
    await expect(webWorkspaceHostE2e.getConnection('stopped')).resolves.toBeNull()

    mocks.findStatusBySlug.mockResolvedValueOnce(null)
    await expect(desktopWorkspaceHostE2e.getAgentConnection('missing')).resolves.toBeNull()

    mocks.findStatusBySlug.mockResolvedValueOnce(runningInstance)
    mocks.getE2eRuntimeConnection.mockReturnValueOnce(null)
    await expect(webWorkspaceHostE2e.getAgentConnection('alice')).resolves.toBeNull()
  })
})
