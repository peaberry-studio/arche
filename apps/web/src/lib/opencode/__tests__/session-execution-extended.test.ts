import { beforeEach, describe, expect, it, vi } from 'vitest'

const touchActivityMock = vi.fn()
const recordProviderRunUsageMock = vi.fn()
const getEffectiveCredentialForUserMock = vi.fn()

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
  messageRunService: {
    createActiveRunAfterRuntimeStateCheck: vi.fn(),
  },
  providerUsageService: {
    recordProviderRunUsage: (...args: unknown[]) => recordProviderRunUsageMock(...args),
  },
}))

vi.mock('@/lib/providers/store', () => ({
  getEffectiveCredentialForUser: (...args: unknown[]) => getEffectiveCredentialForUserMock(...args),
}))

vi.mock('@/lib/runtime/workspace-host', () => ({
  getWorkspaceStatus: vi.fn(),
  startWorkspace: vi.fn(),
}))

describe('session-execution extended', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    touchActivityMock.mockResolvedValue(undefined)
    recordProviderRunUsageMock.mockResolvedValue({ ok: true, recorded: true })
    getEffectiveCredentialForUserMock.mockResolvedValue({
      source: 'user',
      credential: { id: 'cred-1', type: 'api', secret: 'enc', version: 1 },
    })
  })

  describe('ensureWorkspaceRunningForExecution', () => {
    it('starts a stopped workspace through the runtime workspace host', async () => {
      const { ensureProviderAccessFreshForExecution } = await import(
        '@/lib/opencode/providers'
      )
      const { getWorkspaceStatus, startWorkspace } = await import('@/lib/runtime/workspace-host')
      const { getWorkspaceStatus: mockedGetWorkspaceStatus, startWorkspace: mockedStartWorkspace } =
        vi.mocked({ getWorkspaceStatus, startWorkspace })

      mockedGetWorkspaceStatus.mockResolvedValueOnce({ status: 'stopped' } as never)
      mockedStartWorkspace.mockResolvedValueOnce({ ok: true } as never)

      const { ensureWorkspaceRunningForExecution } = await import(
        '@/lib/opencode/session-execution'
      )
      await ensureWorkspaceRunningForExecution('slack-bot', 'user-1')

      expect(mockedStartWorkspace).toHaveBeenCalledWith('slack-bot', 'user-1')
      expect(ensureProviderAccessFreshForExecution).toHaveBeenCalledWith({
        slug: 'slack-bot',
        userId: 'user-1',
      })
    })

    it('throws when startWorkspace fails with unexpected error', async () => {
      const { getWorkspaceStatus, startWorkspace } = await import('@/lib/runtime/workspace-host')
      const { getWorkspaceStatus: mockedGetWorkspaceStatus, startWorkspace: mockedStartWorkspace } =
        vi.mocked({ getWorkspaceStatus, startWorkspace })

      mockedGetWorkspaceStatus.mockResolvedValueOnce({ status: 'stopped' } as never)
      mockedStartWorkspace.mockResolvedValueOnce({
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
    it('returns flow_run_timeout', async () => {
      vi.useFakeTimers()

      try {
        let aborted = false
        const abort = vi.fn().mockImplementation(async () => {
          aborted = true
          return { data: true }
        })
        const children = vi.fn().mockResolvedValue({ data: [] })
        const status = vi.fn().mockImplementation(async () => ({
          data: { 'session-1': { type: aborted ? 'idle' : 'busy' } },
        }))
        const messages = vi.fn().mockResolvedValue({
          data: [],
        })

        const { waitForSessionToComplete } = await import('@/lib/opencode/session-execution')
        const promise = waitForSessionToComplete({
          client: {
            session: { abort, children, messages, status },
          } as Parameters<typeof waitForSessionToComplete>[0]['client'],
          sessionId: 'session-1',
          slug: 'slack-bot',
        })

        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000)
        const result = await promise

        expect(result).toBe('flow_run_timeout')
        expect(abort).toHaveBeenCalledWith(
          { sessionID: 'session-1' },
          { throwOnError: true },
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('aborts child sessions before the root and confirms the family is idle', async () => {
      const abort = vi.fn().mockResolvedValue({ data: true })
      const children = vi.fn()
        .mockResolvedValueOnce({ data: [{ id: 'child-1' }] })
        .mockResolvedValueOnce({ data: [{ id: 'grandchild-1' }] })
        .mockResolvedValueOnce({ data: [] })
      const status = vi.fn().mockResolvedValue({ data: {} })

      const { abortSessionFamilyAndConfirmIdle } = await import('@/lib/opencode/session-execution')
      const result = await abortSessionFamilyAndConfirmIdle({
        client: { session: { abort, children, status } } as Parameters<
          typeof abortSessionFamilyAndConfirmIdle
        >[0]['client'],
        rootSessionId: 'session-1',
      })

      expect(result).toBe(true)
      expect(abort.mock.calls.map(([input]) => input.sessionID)).toEqual([
        'grandchild-1',
        'child-1',
        'session-1',
      ])
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
