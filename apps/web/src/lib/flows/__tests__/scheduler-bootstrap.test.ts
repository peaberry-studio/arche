import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(),
  shouldStartInlineFlowScheduler: vi.fn(),
  startFlowScheduler: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: mocks.getRuntimeCapabilities,
}))

vi.mock('@/lib/flows/scheduler', () => ({
  shouldStartInlineFlowScheduler: mocks.shouldStartInlineFlowScheduler,
  startFlowScheduler: mocks.startFlowScheduler,
}))

import { ensureFlowSchedulerStarted } from '@/lib/flows/scheduler-bootstrap'

describe('ensureFlowSchedulerStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when flows are disabled', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: false })

    await ensureFlowSchedulerStarted()

    expect(mocks.startFlowScheduler).not.toHaveBeenCalled()
  })

  it('starts the inline scheduler when enabled', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    mocks.shouldStartInlineFlowScheduler.mockReturnValue(true)

    await ensureFlowSchedulerStarted()

    expect(mocks.startFlowScheduler).toHaveBeenCalled()
  })

  it('skips when scheduler mode is not inline', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    mocks.shouldStartInlineFlowScheduler.mockReturnValue(false)

    await ensureFlowSchedulerStarted()

    expect(mocks.startFlowScheduler).not.toHaveBeenCalled()
  })
})
