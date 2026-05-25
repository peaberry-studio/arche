import { describe, expect, it, vi } from 'vitest'

import { dispatchFlowExecution } from '@/lib/flows/execution-dispatcher'

describe('dispatchFlowExecution', () => {
  it('runs dispatched work and centralizes async failure logging', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const success = vi.fn().mockResolvedValue(undefined)
    const failure = vi.fn().mockRejectedValue(new Error('worker_failed'))

    dispatchFlowExecution({ flowId: 'flow-1', runId: 'run-1', trigger: 'manual', type: 'run' }, success)
    dispatchFlowExecution({ flowId: 'flow-2', runId: 'run-2', trigger: 'schedule', type: 'retry' }, failure)

    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      '[flows] Failed to execute dispatched flow task',
      expect.objectContaining({ flowId: 'flow-2', runId: 'run-2', type: 'retry' }),
    ))
  })
})
