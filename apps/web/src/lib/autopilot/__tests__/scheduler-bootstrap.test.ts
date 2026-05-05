import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRuntimeCapabilities = vi.fn()
const mockStartAutopilotScheduler = vi.fn()

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))

vi.mock('@/lib/autopilot/scheduler', () => ({
  startAutopilotScheduler: () => mockStartAutopilotScheduler(),
}))

import { ensureAutopilotSchedulerStarted } from '../scheduler-bootstrap'

describe('ensureAutopilotSchedulerStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when autopilot capability is disabled', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ autopilot: false })
    await ensureAutopilotSchedulerStarted()
    expect(mockStartAutopilotScheduler).not.toHaveBeenCalled()
  })

  it('starts scheduler when autopilot capability is enabled', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ autopilot: true })
    mockStartAutopilotScheduler.mockImplementation(() => {})

    await ensureAutopilotSchedulerStarted()
    expect(mockStartAutopilotScheduler).toHaveBeenCalledOnce()
  })

  it('logs error when scheduler fails to start', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({ autopilot: true })
    mockStartAutopilotScheduler.mockImplementation(() => {
      throw new Error('Scheduler failure')
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureAutopilotSchedulerStarted()
    expect(consoleSpy).toHaveBeenCalledWith(
      '[autopilot] Failed to start scheduler',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })
})
