import { beforeEach, describe, expect, it, vi } from 'vitest'

const listAutopilotAgentOptionsMock = vi.fn()
const assertValidAutopilotTimeZoneMock = vi.fn()
const validateAutopilotCronExpressionMock = vi.fn()

vi.mock('@/lib/autopilot/agents', () => ({
  listAutopilotAgentOptions: (...args: unknown[]) => listAutopilotAgentOptionsMock(...args),
}))

vi.mock('@/lib/autopilot/cron', () => ({
  assertValidAutopilotTimeZone: (tz: string) => assertValidAutopilotTimeZoneMock(tz),
  validateAutopilotCronExpression: (expr: string, tz: string) => validateAutopilotCronExpressionMock(expr, tz),
}))

describe('validateAutopilotTaskPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAutopilotAgentOptionsMock.mockResolvedValue({
      ok: true,
      agents: [
        { id: 'assistant', displayName: 'Assistant', isPrimary: true },
        { id: 'researcher', displayName: 'Researcher', isPrimary: false },
      ],
    })
    assertValidAutopilotTimeZoneMock.mockImplementation((tz: string) => tz)
    validateAutopilotCronExpressionMock.mockImplementation((expr: string) => expr)
  })

  it('rejects non-object bodies', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    for (const body of [null, undefined, 'string', 42, true, ['array']]) {
      const result = await validateAutopilotTaskPayload(body, 'create')
      expect(result).toEqual({ ok: false, error: 'invalid_body', status: 400 })
    }
  })

  it('rejects an empty name in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: '   ', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_name', status: 400 })
  })

  it('rejects an empty prompt in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: '', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_prompt', status: 400 })
  })

  it('rejects invalid timezone type in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 42, enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
  })

  it('rejects timezone that fails validation in create mode', async () => {
    assertValidAutopilotTimeZoneMock.mockImplementation(() => { throw new Error('bad tz') })
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'Bad/Zone', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
  })

  it('rejects invalid cronExpression type in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: 42, timezone: 'UTC', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_cron_expression', status: 400 })
  })

  it('rejects cronExpression when timezone is unavailable', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
  })

  it('rejects cronExpression that fails validation', async () => {
    validateAutopilotCronExpressionMock.mockImplementation(() => { throw new Error('bad cron') })
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: 'bad', timezone: 'UTC', enabled: true },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_cron_expression', status: 400 })
  })

  it('allows null targetAgentId in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true, targetAgentId: null },
      'create',
    )
    expect(result.ok).toBe(true)
  })

  it('rejects empty string targetAgentId in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true, targetAgentId: '' },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_target_agent', status: 400 })
  })

  it('rejects disabled kb when validating target agent', async () => {
    listAutopilotAgentOptionsMock.mockResolvedValue({ ok: false, error: 'kb_unavailable' })
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true, targetAgentId: 'assistant' },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'kb_unavailable', status: 503 })
  })

  it('rejects generic agent listing errors with 500', async () => {
    listAutopilotAgentOptionsMock.mockResolvedValue({ ok: false, error: 'db_error' })
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true, targetAgentId: 'assistant' },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'db_error', status: 500 })
  })

  it('rejects non-boolean enabled in create mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: 'yes' },
      'create',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_enabled', status: 400 })
  })

  it('skips name validation in update mode when name is absent', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true },
      'update',
    )
    expect(result.ok).toBe(true)
    expect(result.value).not.toHaveProperty('name')
  })

  it('validates name in update mode when name is present', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: '', prompt: 'hello', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true },
      'update',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_name', status: 400 })
  })

  it('skips prompt validation in update mode when prompt is absent', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true },
      'update',
    )
    expect(result.ok).toBe(true)
    expect(result.value).not.toHaveProperty('prompt')
  })

  it('skips timezone validation in update mode when timezone is absent and no cron', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', enabled: true },
      'update',
    )
    expect(result.ok).toBe(true)
    expect(result.value).not.toHaveProperty('timezone')
  })

  it('rejects pure cronExpression update without fallback or body timezone', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { cronExpression: '0 9 * * *' },
      'update',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
  })

  it('accepts partial update with only enabled', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { enabled: false },
      'update',
    )
    expect(result).toEqual({ ok: true, value: { enabled: false } })
  })

  it('rejects invalid targetAgentId in update mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { enabled: true, targetAgentId: 123 },
      'update',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_target_agent', status: 400 })
  })

  it('rejects unknown targetAgentId in update mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { enabled: true, targetAgentId: 'unknown-agent' },
      'update',
    )
    expect(result).toEqual({ ok: false, error: 'unknown_target_agent', status: 400 })
  })

  it('accepts valid targetAgentId in update mode', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { enabled: true, targetAgentId: 'assistant' },
      'update',
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(expect.objectContaining({ targetAgentId: 'assistant' }))
  })

  it('rejects when valid cron exists but timezone is missing and there is no fallback', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      { name: 'Task', prompt: 'hello', enabled: true, cronExpression: '0 9 * * *' },
      'update',
    )
    expect(result).toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
  })

  it('accepts update with valid name, prompt, timezone, cron, enabled', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        name: 'Updated',
        prompt: 'Updated prompt',
        timezone: 'Europe/Madrid',
        cronExpression: '30 17 * * *',
        enabled: false,
      },
      'update',
    )
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Updated',
        prompt: 'Updated prompt',
        timezone: 'Europe/Madrid',
        cronExpression: '30 17 * * *',
        enabled: false,
      },
    })
  })

  it('accepts Slack notification targets when enabled', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        enabled: true,
        slackNotificationConfig: {
          enabled: true,
          includeSessionLink: true,
          targets: [
            { type: 'dm', userId: 'user-1' },
            { type: 'channel', channelId: 'C123' },
          ],
        },
      },
      'update',
    )

    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        slackNotificationConfig: {
          enabled: true,
          includeSessionLink: true,
          targets: [
            { type: 'dm', userId: 'user-1' },
            { type: 'channel', channelId: 'C123' },
          ],
        },
      },
    })
  })

  it('requires at least one Slack notification target when enabled', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        enabled: true,
        slackNotificationConfig: {
          enabled: true,
          includeSessionLink: true,
          targets: [],
        },
      },
      'update',
    )

    expect(result).toEqual({ ok: false, error: 'slack_notification_targets_required', status: 400 })
  })

  it('accepts null Slack notification config to clear existing settings', async () => {
    const { validateAutopilotTaskPayload } = await import('../payload')
    const result = await validateAutopilotTaskPayload(
      {
        slackNotificationConfig: null,
      },
      'update',
    )

    expect(result).toEqual({ ok: true, value: { slackNotificationConfig: null } })
  })
})
