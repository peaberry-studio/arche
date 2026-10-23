import { ChildProcess } from 'child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { waitForProcessExit } from '@/lib/runtime/desktop/process'

describe('waitForProcessExit', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it.each([
    { exitCode: 0, signalCode: null },
    { exitCode: null, signalCode: 'SIGTERM' },
  ] as const)('resolves immediately for an exited process (%j)', async (state) => {
    const child = Object.assign(new ChildProcess(), state)

    expect(await waitForProcessExit(child, 5_000)).toBe(true)
    expect(child.listenerCount('exit')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for actual exit, not the killed flag, and clears its deadline', async () => {
    const child = Object.assign(new ChildProcess(), { killed: true })
    const pending = waitForProcessExit(child, 5_000)

    expect(child.listenerCount('exit')).toBe(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(child.listenerCount('exit')).toBe(1)
    child.emit('exit', 0, null)

    expect(await pending).toBe(true)
    expect(child.listenerCount('exit')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes only its own listener on timeout and allows a later cleanup retry', async () => {
    const child = new ChildProcess()
    const onExit = vi.fn()
    child.on('exit', onExit)
    const pending = waitForProcessExit(child, 5_000)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toBe(false)
    expect(child.listeners('exit')).toEqual([onExit])

    const retry = waitForProcessExit(child, 5_000)
    child.emit('exit', 0, null)
    expect(await retry).toBe(true)
    expect(onExit).toHaveBeenCalledOnce()
    expect(child.listeners('exit')).toEqual([onExit])
    expect(vi.getTimerCount()).toBe(0)
  })
})
