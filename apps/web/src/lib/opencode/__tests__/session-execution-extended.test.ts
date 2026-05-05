import { beforeEach, describe, expect, it, vi } from 'vitest'

const touchActivityMock = vi.fn()

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: vi.fn(),
}))

vi.mock('@/lib/opencode/providers', () => ({
  ensureProviderAccessFreshForExecution: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    touchActivity: (...args: unknown[]) => touchActivityMock(...args),
  },
}))

vi.mock('@/lib/spawner/core', () => ({
  getInstanceStatus: vi.fn(),
  startInstance: vi.fn(),
}))

describe('session-execution extended', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    touchActivityMock.mockResolvedValue(undefined)
  })

  describe('ensureWorkspaceRunningForExecution', () => {
    it('starts a stopped workspace', async () => {
      const { ensureProviderAccessFreshForExecution } = await import(
        '@/lib/opencode/providers'
      )
      const { getInstanceStatus, startInstance } = await import('@/lib/spawner/core')
      const { getInstanceStatus: mockedGetInstanceStatus, startInstance: mockedStartInstance } =
        vi.mocked({ getInstanceStatus, startInstance })

      mockedGetInstanceStatus.mockResolvedValueOnce({ status: 'stopped' } as never)
      mockedStartInstance.mockResolvedValueOnce({ ok: true } as never)

      const { ensureWorkspaceRunningForExecution } = await import(
        '@/lib/opencode/session-execution'
      )
      await ensureWorkspaceRunningForExecution('slack-bot', 'user-1')

      expect(mockedStartInstance).toHaveBeenCalledWith('slack-bot', 'user-1')
      expect(ensureProviderAccessFreshForExecution).toHaveBeenCalledWith({
        slug: 'slack-bot',
        userId: 'user-1',
      })
    })

    it('throws when startInstance fails with unexpected error', async () => {
      const { getInstanceStatus, startInstance } = await import('@/lib/spawner/core')
      const { getInstanceStatus: mockedGetInstanceStatus, startInstance: mockedStartInstance } =
        vi.mocked({ getInstanceStatus, startInstance })

      mockedGetInstanceStatus.mockResolvedValueOnce({ status: 'stopped' } as never)
      mockedStartInstance.mockResolvedValueOnce({
        ok: false,
        error: 'insufficient_capacity',
        detail: 'No resources',
      } as never)

      const { ensureWorkspaceRunningForExecution } = await import(
        '@/lib/opencode/session-execution'
      )

      await expect(
        ensureWorkspaceRunningForExecution('slack-bot', 'user-1')
      ).rejects.toThrow('No resources')
    })
  })

  describe('captureSessionMessageCursor', () => {
    it('returns cursor with current message count', async () => {
      vi.doMock('@/lib/services', () => ({
        instanceService: {
          touchActivity: (...args: unknown[]) => touchActivityMock(...args),
        },
      }))
      const messages = vi.fn().mockResolvedValue({
        data: [
          { info: { role: 'user' }, parts: [] },
          { info: { role: 'assistant' }, parts: [] },
        ],
      })

      const { captureSessionMessageCursor } = await import(
        '@/lib/opencode/session-execution'
      )
      const cursor = await captureSessionMessageCursor(
        { session: { messages } } as Parameters<typeof captureSessionMessageCursor>[0],
        'session-1'
      )

      expect(cursor.messageCount).toBe(2)
    })
  })

  describe('waitForSessionToComplete', () => {
    it('returns autopilot_run_timeout', async () => {
      vi.useFakeTimers()

      try {
        const status = vi.fn().mockResolvedValue({
          data: { 'session-1': { type: 'busy' } },
        })
        const messages = vi.fn().mockResolvedValue({
          data: [],
        })

        const { waitForSessionToComplete } = await import('@/lib/opencode/session-execution')
        const promise = waitForSessionToComplete({
          client: {
            session: { messages, status },
          } as Parameters<typeof waitForSessionToComplete>[0]['client'],
          sessionId: 'session-1',
          slug: 'slack-bot',
        })

        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000)
        const result = await promise

        expect(result).toBe('autopilot_run_timeout')
      } finally {
        vi.useRealTimers()
      }
    })

    it('calls onPulse during execution', async () => {
      vi.useFakeTimers()

      try {
        const onPulse = vi.fn().mockResolvedValue(undefined)
        const status = vi.fn().mockResolvedValue({
          data: { 'session-1': { type: 'idle' } },
        })
        const messages = vi.fn().mockResolvedValue({
          data: [
            {
              info: { role: 'assistant', time: { completed: 1 } },
              parts: [{ id: 'p1', text: 'Done', type: 'text' }],
            },
          ],
        })

        const { waitForSessionToComplete } = await import('@/lib/opencode/session-execution')
        const promise = waitForSessionToComplete({
          client: { session: { messages, status } } as Parameters<
            typeof waitForSessionToComplete
          >[0]['client'],
          sessionId: 'session-1',
          slug: 'slack-bot',
          onPulse,
        })

        await vi.advanceTimersByTimeAsync(2_000)
        await promise

        expect(onPulse).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
