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

describe('session execution helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    touchActivityMock.mockResolvedValue(undefined)
  })

  it('ignores assistant replies that were already in the session before the current run', async () => {
    vi.useFakeTimers()

    try {
      const status = vi.fn().mockResolvedValue({
        data: {
          'session-1': { type: 'idle' },
        },
      })
      const messages = vi.fn().mockResolvedValue({
        data: [
          {
            info: {
              role: 'assistant',
              time: { completed: 1 },
            },
            parts: [{ id: 'part-1', text: 'Previous reply', type: 'text' }],
          },
        ],
      })

      const { waitForSessionToComplete } = await import('../session-execution')
      const runPromise = waitForSessionToComplete({
        client: {
          session: { messages, status },
        } as Parameters<typeof waitForSessionToComplete>[0]['client'],
        cursor: { messageCount: 1 },
        sessionId: 'session-1',
        slug: 'slack-bot',
      })

      await vi.advanceTimersByTimeAsync(16_000)

      await expect(runPromise).resolves.toBe('autopilot_no_assistant_message')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read stale assistant text that predates the current session cursor', async () => {
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
          },
          parts: [{ id: 'part-1', text: 'Previous reply', type: 'text' }],
        },
      ],
    })

    const { readLatestAssistantText } = await import('../session-execution')
    await expect(readLatestAssistantText(
      {
        session: { messages },
      } as Parameters<typeof readLatestAssistantText>[0],
      'session-1',
      { messageCount: 1 },
    )).resolves.toBeNull()
  })

  it('returns only visible assistant text and excludes reasoning parts', async () => {
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
          },
          parts: [
            { id: 'part-1', text: 'Internal reasoning', type: 'reasoning' },
            { id: 'part-2', text: 'Final reply', type: 'text' },
          ],
        },
      ],
    })

    const { readLatestAssistantText } = await import('../session-execution')
    await expect(readLatestAssistantText(
      {
        session: { messages },
      } as Parameters<typeof readLatestAssistantText>[0],
      'session-1',
    )).resolves.toBe('Final reply')
  })

  it('skips non-assistant messages while reading the latest assistant text', async () => {
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
          },
          parts: [{ id: 'part-1', text: 'Earlier reply', type: 'text' }],
        },
        {
          info: {
            role: 'event',
            time: { completed: 2 },
          },
          parts: [{ id: 'part-2', text: 'Tool event', type: 'text' }],
        },
      ],
    })

    const { readLatestAssistantText } = await import('../session-execution')
    await expect(readLatestAssistantText(
      {
        session: { messages },
      } as Parameters<typeof readLatestAssistantText>[0],
      'session-1',
    )).resolves.toBe('Earlier reply')
  })

  it('returns provider_auth_missing when the assistant run ends with a provider auth error', async () => {
    const status = vi.fn().mockResolvedValue({
      data: {
        'session-1': { type: 'idle' },
      },
    })
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
            error: {
              data: {
                message: 'OpenRouter API key is missing. Pass it using OPENROUTER_API_KEY.',
              },
              name: 'ProviderAuthError',
            },
          },
          parts: [],
        },
      ],
    })

    const { waitForSessionToComplete } = await import('../session-execution')

    await expect(waitForSessionToComplete({
      client: {
        session: { messages, status },
      } as Parameters<typeof waitForSessionToComplete>[0]['client'],
      sessionId: 'session-1',
      slug: 'slack-bot',
    })).resolves.toBe('provider_auth_missing')
  })

  it('detects provider auth failures from the assistant error message', async () => {
    const status = vi.fn().mockResolvedValue({
      data: {
        'session-1': { type: 'idle' },
      },
    })
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
            error: {
              data: {
                message: 'Configure the openrouter provider before running this task.',
              },
              name: 'RuntimeError',
            },
          },
          parts: [],
        },
      ],
    })

    const { waitForSessionToComplete } = await import('../session-execution')

    await expect(waitForSessionToComplete({
      client: {
        session: { messages, status },
      } as Parameters<typeof waitForSessionToComplete>[0]['client'],
      sessionId: 'session-1',
      slug: 'slack-bot',
    })).resolves.toBe('provider_auth_missing')
  })

  it('does not treat unrelated assistant errors as provider auth failures', async () => {
    const status = vi.fn().mockResolvedValue({
      data: {
        'session-1': { type: 'idle' },
      },
    })
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: { completed: 1 },
            error: {
              data: {
                message: 'Model overloaded',
              },
              name: 'RuntimeError',
            },
          },
          parts: [{ id: 'part-1', text: 'Done', type: 'text' }],
        },
      ],
    })

    const { waitForSessionToComplete } = await import('../session-execution')

    await expect(waitForSessionToComplete({
      client: {
        session: { messages, status },
      } as Parameters<typeof waitForSessionToComplete>[0]['client'],
      sessionId: 'session-1',
      slug: 'slack-bot',
    })).resolves.toBeNull()
  })

  it('reports no assistant message when the idle outcome has only non-assistant messages', async () => {
    const status = vi.fn().mockResolvedValue({
      data: {
        'session-1': { type: 'idle' },
      },
    })
    const messages = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            info: {
              role: 'assistant',
              time: { completed: 1 },
            },
            parts: [{ id: 'part-1', text: 'Done', type: 'text' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            info: {
              role: 'event',
              time: { completed: 2 },
            },
            parts: [],
          },
        ],
      })

    const { waitForSessionToComplete } = await import('../session-execution')

    await expect(waitForSessionToComplete({
      client: {
        session: { messages, status },
      } as Parameters<typeof waitForSessionToComplete>[0]['client'],
      sessionId: 'session-1',
      slug: 'slack-bot',
    })).resolves.toBe('autopilot_no_assistant_message')
  })

  it('keeps polling while an idle assistant message still has a running tool', async () => {
    vi.useFakeTimers()

    try {
      const pendingMessage = {
        info: {
          role: 'assistant',
          time: {},
        },
        parts: [
          {
            id: 'tool-1',
            state: { input: {}, status: 'running', title: 'reading' },
            tool: 'read_file',
            type: 'tool',
          },
        ],
      }
      const completedMessage = {
        info: {
          role: 'assistant',
          time: { completed: 1 },
        },
        parts: [{ id: 'part-1', text: 'Done', type: 'text' }],
      }
      const status = vi.fn().mockResolvedValue({
        data: {
          'session-1': { type: 'idle' },
        },
      })
      const messages = vi
        .fn()
        .mockResolvedValueOnce({ data: [pendingMessage] })
        .mockResolvedValueOnce({ data: [pendingMessage] })
        .mockResolvedValueOnce({ data: [completedMessage] })
        .mockResolvedValueOnce({ data: [completedMessage] })

      const { waitForSessionToComplete } = await import('../session-execution')
      const promise = waitForSessionToComplete({
        client: {
          session: { messages, status },
        } as Parameters<typeof waitForSessionToComplete>[0]['client'],
        sessionId: 'session-1',
        slug: 'slack-bot',
      })

      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).resolves.toBeNull()
      expect(messages).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns tool error details from the assistant runtime state', async () => {
    const status = vi.fn().mockResolvedValue({
      data: {
        'session-1': { type: 'idle' },
      },
    })
    const messages = vi.fn().mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: {},
          },
          parts: [
            {
              id: 'tool-1',
              state: { error: 'permission denied', input: {}, status: 'error' },
              tool: 'bash',
              type: 'tool',
            },
          ],
        },
      ],
    })

    const { waitForSessionToComplete } = await import('../session-execution')

    await expect(waitForSessionToComplete({
      client: {
        session: { messages, status },
      } as Parameters<typeof waitForSessionToComplete>[0]['client'],
      sessionId: 'session-1',
      slug: 'slack-bot',
    })).resolves.toBe('permission denied')
  })

  it('refreshes provider access when execution reuses a running workspace', async () => {
    const { ensureProviderAccessFreshForExecution } = await import('@/lib/opencode/providers')
    const { getInstanceStatus } = await import('@/lib/spawner/core')

    vi.mocked(getInstanceStatus).mockResolvedValue({ status: 'running' } as never)

    const { ensureWorkspaceRunningForExecution } = await import('../session-execution')
    await ensureWorkspaceRunningForExecution('slack-bot', 'user-1')

    expect(ensureProviderAccessFreshForExecution).toHaveBeenCalledWith({
      slug: 'slack-bot',
      userId: 'user-1',
    })
  })

  it('refreshes provider access after a workspace finishes starting', async () => {
    vi.useFakeTimers()

    try {
      const { ensureProviderAccessFreshForExecution } = await import('@/lib/opencode/providers')
      const { getInstanceStatus } = await import('@/lib/spawner/core')

      vi.mocked(getInstanceStatus)
        .mockResolvedValueOnce({ status: 'starting' } as never)
        .mockResolvedValueOnce({ status: 'running' } as never)

      const { ensureWorkspaceRunningForExecution } = await import('../session-execution')
      const promise = ensureWorkspaceRunningForExecution('slack-bot', 'user-1')

      await vi.advanceTimersByTimeAsync(2_000)
      await promise

      expect(ensureProviderAccessFreshForExecution).toHaveBeenCalledWith({
        slug: 'slack-bot',
        userId: 'user-1',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out when a workspace never finishes starting', async () => {
    vi.useFakeTimers()

    try {
      const { getInstanceStatus } = await import('@/lib/spawner/core')

      vi.mocked(getInstanceStatus).mockResolvedValue({ status: 'starting' } as never)

      const { ensureWorkspaceRunningForExecution } = await import('../session-execution')
      const promise = ensureWorkspaceRunningForExecution('slack-bot', 'user-1')
      const expectation = expect(promise).rejects.toThrow('instance_start_timeout')

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

      await expectation
    } finally {
      vi.useRealTimers()
    }
  })
})
