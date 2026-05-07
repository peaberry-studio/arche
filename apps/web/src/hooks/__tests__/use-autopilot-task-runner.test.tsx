/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutopilotTaskRunner } from '@/hooks/use-autopilot-task-runner'

describe('useAutopilotTaskRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads tasks and refreshes them after running a task', async () => {
    const onRunTaskComplete = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(Response.json({ tasks: [{ id: 'task-1', name: 'Task', prompt: 'Do it' }] }))
        .mockResolvedValueOnce(Response.json({ ok: true }))
        .mockResolvedValueOnce(Response.json({ tasks: [{ id: 'task-2', name: 'Next', prompt: 'Again' }] }))
    )

    const { result } = renderHook(() =>
      useAutopilotTaskRunner({ slug: 'alice', onRunTaskComplete })
    )

    await act(async () => {
      await result.current.loadTasks()
    })
    expect(result.current.tasks).toEqual([{ id: 'task-1', name: 'Task', prompt: 'Do it' }])

    await act(async () => {
      await result.current.runTask('task-1')
    })

    expect(onRunTaskComplete).toHaveBeenCalledTimes(1)
    expect(result.current.runningTaskId).toBeNull()
    expect(result.current.tasks).toEqual([{ id: 'task-2', name: 'Next', prompt: 'Again' }])
  })

  it('stores load and run errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(Response.json({ error: 'load_error' }, { status: 500 }))
        .mockResolvedValueOnce(Response.json({ error: 'run_error' }, { status: 400 }))
    )

    const { result } = renderHook(() => useAutopilotTaskRunner({ slug: 'alice' }))

    await act(async () => {
      await result.current.loadTasks()
    })
    expect(result.current.runError).toBe('load_error')
    expect(result.current.isLoadingTasks).toBe(false)

    await act(async () => {
      await result.current.runTask('task-1')
    })
    await waitFor(() => expect(result.current.runError).toBe('run_error'))
    expect(result.current.runningTaskId).toBeNull()
  })

  it('stores network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useAutopilotTaskRunner({ slug: 'alice' }))

    await act(async () => {
      await result.current.loadTasks()
    })
    expect(result.current.runError).toBe('network_error')
  })
})
