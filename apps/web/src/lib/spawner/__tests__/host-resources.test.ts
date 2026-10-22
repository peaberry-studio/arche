import { describe, expect, it, vi } from 'vitest'

vi.mock('os', () => ({ freemem: () => 2 * 1024 * 1024 * 1024, totalmem: () => 8 * 1024 * 1024 * 1024 }))

import { isUnderMemoryPressure, parseMeminfo, readHostMemory } from '@/lib/spawner/host-resources'

const MEMINFO = [
  'MemTotal:       16384000 kB',
  'MemFree:          512000 kB',
  'MemAvailable:    4096000 kB',
  'Buffers:          102400 kB',
].join('\n')

describe('host memory', () => {
  it('reads MemAvailable rather than MemFree from /proc/meminfo', async () => {
    const read = vi.fn().mockResolvedValue(MEMINFO)

    expect(await readHostMemory(read)).toEqual({ availableBytes: 4096000 * 1024, totalBytes: 16384000 * 1024, source: 'meminfo' })
    expect(read).toHaveBeenCalledWith('/proc/meminfo')
  })

  it.each([
    ['missing /proc/meminfo', vi.fn().mockRejectedValue(new Error('ENOENT'))],
    ['a kernel without MemAvailable', vi.fn().mockResolvedValue('MemTotal: 1000 kB\nMemFree: 10 kB')],
  ])('falls back to the OS counters on %s', async (_label, read) => {
    expect(await readHostMemory(read)).toEqual({ availableBytes: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3, source: 'os' })
  })

  it('rejects meminfo without a usable total', () => {
    expect(parseMeminfo('MemTotal: 0 kB\nMemAvailable: 10 kB')).toBeNull()
    expect(parseMeminfo('garbage')).toBeNull()
  })

  it.each([
    { label: 'plenty available', available: 8, policy: { minAvailablePercent: 15, minAvailableMb: null }, expected: false },
    { label: 'below the percentage', available: 2, policy: { minAvailablePercent: 15, minAvailableMb: null }, expected: true },
    { label: 'exactly at the percentage', available: 2.4, policy: { minAvailablePercent: 15, minAvailableMb: null }, expected: false },
    { label: 'below the absolute floor', available: 3, policy: { minAvailablePercent: 15, minAvailableMb: 4096 }, expected: true },
    { label: 'above both floors', available: 5, policy: { minAvailablePercent: 15, minAvailableMb: 4096 }, expected: false },
  ])('reports pressure with $label', ({ available, policy, expected }) => {
    const memory = { availableBytes: available * 1024 ** 3, totalBytes: 16 * 1024 ** 3, source: 'meminfo' as const }
    expect(isUnderMemoryPressure(memory, policy)).toBe(expected)
  })
})
