/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowRunner } from '@/hooks/use-flow-runner'

const clientMocks = vi.hoisted(() => ({
  fetchFlowList: vi.fn(),
  runFlowRequest: vi.fn(),
}))

vi.mock('@/lib/flows/client', () => ({
  fetchFlowList: clientMocks.fetchFlowList,
  runFlowRequest: clientMocks.runFlowRequest,
}))

describe('useFlowRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.fetchFlowList.mockResolvedValue({ ok: true, data: { flows: [] } })
    clientMocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true, runId: 'run-1' } })
  })

  afterEach(() => cleanup())

  it('loads flows', async () => {
    const { result } = renderHook(() => useFlowRunner({ slug: 'alice' }))

    await act(async () => {
      await result.current.loadFlows()
    })

    expect(clientMocks.fetchFlowList).toHaveBeenCalledWith('alice')
    expect(result.current.flows).toEqual([])
  })

  it('runs a flow and invokes completion callback', async () => {
    const onRunFlowComplete = vi.fn()
    const { result } = renderHook(() => useFlowRunner({ slug: 'alice', onRunFlowComplete }))

    await act(async () => {
      await result.current.runFlow('flow-1')
    })

    expect(clientMocks.runFlowRequest).toHaveBeenCalledWith('alice', 'flow-1')
    await waitFor(() => expect(onRunFlowComplete).toHaveBeenCalled())
  })

  it('stores load errors', async () => {
    clientMocks.fetchFlowList.mockResolvedValue({ ok: false, error: 'load_failed' })
    const { result } = renderHook(() => useFlowRunner({ slug: 'alice' }))

    await act(async () => {
      await result.current.loadFlows()
    })

    expect(result.current.runError).toBe('load_failed')
  })
})
