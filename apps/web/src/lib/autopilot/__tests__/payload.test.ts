import { beforeEach, describe, expect, it, vi } from 'vitest'

const listAutopilotAgentOptionsMock = vi.fn()

vi.mock('@/lib/autopilot/agents', () => ({
  listAutopilotAgentOptions: (...args: unknown[]) => listAutopilotAgentOptionsMock(...args),
}))

describe('autopilot payload validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAutopilotAgentOptionsMock.mockResolvedValue({
      ok: true,
      agents: [
        { id: 'assistant', displayName: 'Assistant', isPrimary: true },
        { id: 'researcher', displayName: 'Researcher', isPrimary: false },
      ],
    })
  })

  it('accepts valid create payloads', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        name: 'Daily summary',
        prompt: 'Summarize the latest work',
        targetAgentId: 'researcher',
        cronExpression: '0 9 * * 1-5',
        timezone: 'UTC',
        enabled: true,
      },
      'create'
    )

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Daily summary',
        prompt: 'Summarize the latest work',
        targetAgentId: 'researcher',
        cronExpression: '0 9 * * 1-5',
        timezone: 'UTC',
        enabled: true,
      },
    })
  })

  it('rejects unknown target agents', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        name: 'Daily summary',
        prompt: 'Summarize the latest work',
        targetAgentId: 'unknown',
        cronExpression: '0 9 * * 1-5',
        timezone: 'UTC',
        enabled: true,
      },
      'create'
    )

    expect(result).toEqual({ ok: false, error: 'unknown_target_agent', status: 400 })
  })

  it('accepts cron-only task updates when a fallback timezone is provided', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        cronExpression: '0 9 * * 1-5',
      },
      'update',
      { fallbackTimezone: 'UTC' }
    )

    expect(result).toEqual({
      ok: true,
      value: {
        cronExpression: '0 9 * * 1-5',
      },
    })
  })
})
