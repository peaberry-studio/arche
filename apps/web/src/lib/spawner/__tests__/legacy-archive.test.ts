import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isHistoryMigrationInProgress, withHistoryMigrationProgress } from '@/lib/spawner/legacy-archive'

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), unlink: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, writeFile: mocks.write, unlink: mocks.unlink }))
vi.mock('@/lib/user-data', () => ({ ensureUserDirectory: async () => '/users/alice', getUserDataHostPath: () => '/users/alice' }))
vi.mock('@/lib/spawner/config', () => ({ getStartTimeoutMs: () => 120_000 }))

describe('history migration progress', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('is visible across processes through the shared user-data marker', async () => {
    mocks.read.mockResolvedValue(JSON.stringify({ startedAt: Date.now(), attempt: 'fixture' }))
    expect(await isHistoryMigrationInProgress('alice')).toBe(true)
    expect(mocks.read).toHaveBeenCalledWith('/users/alice/legacy-history-migration.json', 'utf8')
  })

  it('ignores a marker left by an interrupted old attempt', async () => {
    mocks.read.mockResolvedValue(JSON.stringify({ startedAt: Date.now() - 240_001 }))
    expect(await isHistoryMigrationInProgress('alice')).toBe(false)
  })

  it('is false when there is no migration marker', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(await isHistoryMigrationInProgress('alice')).toBe(false)
  })

  it('clears its marker on successful and failed exports without hiding a newer attempt', async () => {
    mocks.write.mockImplementation(async (_path: string, value: string) => { mocks.read.mockResolvedValue(value) })
    expect(await withHistoryMigrationProgress('alice', async () => 'complete')).toBe('complete')
    expect(mocks.unlink).toHaveBeenCalledOnce()
    await expect(withHistoryMigrationProgress('alice', async () => { throw new Error('export failed') })).rejects.toThrow('export failed')
    expect(mocks.unlink).toHaveBeenCalledTimes(2)
    await withHistoryMigrationProgress('alice', async () => { mocks.read.mockResolvedValue('newer-attempt') })
    expect(mocks.unlink).toHaveBeenCalledTimes(2)
    expect(mocks.write).toHaveBeenCalledWith('/users/alice/legacy-history-migration.json', expect.any(String), { mode: 0o600 })
  })
})
