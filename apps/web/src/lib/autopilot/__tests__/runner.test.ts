import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutopilotClaimedTask } from '@/lib/services/autopilot'

const getInstanceStatusMock = vi.fn()
const startInstanceMock = vi.fn()
const createInstanceClientMock = vi.fn()
const createRunMock = vi.fn()
const attachRunSessionMock = vi.fn()
const extendTaskLeaseMock = vi.fn()
const markRunSucceededMock = vi.fn()
const markRunFailedMock = vi.fn()
const scheduleTaskRetryMock = vi.fn()
const clearTaskRetryStateMock = vi.fn()
const releaseTaskLeaseMock = vi.fn()
const claimTaskForImmediateRunMock = vi.fn()
const findTaskByIdAndUserIdMock = vi.fn()
const touchActivityMock = vi.fn()
const findByIdSelectMock = vi.fn()
const createAuditEventMock = vi.fn()
const ensureProviderAccessFreshForExecutionMock = vi.fn()
const sendSlackNotificationsMock = vi.fn()

vi.mock('@/lib/spawner/core', () => ({
  getInstanceStatus: (...args: unknown[]) => getInstanceStatusMock(...args),
  startInstance: (...args: unknown[]) => startInstanceMock(...args),
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: (...args: unknown[]) => createInstanceClientMock(...args),
}))

vi.mock('@/lib/opencode/providers', () => ({
  ensureProviderAccessFreshForExecution: (...args: unknown[]) => ensureProviderAccessFreshForExecutionMock(...args),
}))

vi.mock('@/lib/services', () => ({
  auditService: {
    createEvent: (...args: unknown[]) => createAuditEventMock(...args),
  },
  autopilotService: {
    attachRunSession: (...args: unknown[]) => attachRunSessionMock(...args),
    claimTaskForImmediateRun: (...args: unknown[]) => claimTaskForImmediateRunMock(...args),
    createRun: (...args: unknown[]) => createRunMock(...args),
    clearTaskRetryState: (...args: unknown[]) => clearTaskRetryStateMock(...args),
    extendTaskLease: (...args: unknown[]) => extendTaskLeaseMock(...args),
    findTaskByIdAndUserId: (...args: unknown[]) => findTaskByIdAndUserIdMock(...args),
    markRunFailed: (...args: unknown[]) => markRunFailedMock(...args),
    markRunSucceeded: (...args: unknown[]) => markRunSucceededMock(...args),
    releaseTaskLease: (...args: unknown[]) => releaseTaskLeaseMock(...args),
    scheduleTaskRetry: (...args: unknown[]) => scheduleTaskRetryMock(...args),
  },
  instanceService: {
    touchActivity: (...args: unknown[]) => touchActivityMock(...args),
  },
  userService: {
    findByIdSelect: (...args: unknown[]) => findByIdSelectMock(...args),
  },
}))

vi.mock('@/lib/slack/notifications', () => ({
  sendSlackNotifications: (...args: unknown[]) => sendSlackNotificationsMock(...args),
}))

function buildClaimedTask(overrides: Partial<AutopilotClaimedTask> = {}): AutopilotClaimedTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    name: 'Daily summary',
    prompt: 'Summarize the day',
    targetAgentId: null,
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: new Date('2026-04-13T09:00:00.000Z'),
    lastRunAt: null,
    leaseOwner: 'lease-1',
    leaseExpiresAt: new Date('2026-04-12T09:15:00.000Z'),
    retryAttempt: 0,
    retryScheduledFor: null,
    createdAt: new Date('2026-04-12T08:00:00.000Z'),
    updatedAt: new Date('2026-04-12T08:00:00.000Z'),
    scheduledFor: new Date('2026-04-12T09:00:00.000Z'),
    ...overrides,
  }
}

describe('autopilot runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInstanceStatusMock.mockResolvedValue({ status: 'running' })
    startInstanceMock.mockResolvedValue({ ok: true, status: 'running' })
    findByIdSelectMock.mockResolvedValue({ slug: 'alice' })
    createRunMock.mockResolvedValue({ id: 'run-1' })
    attachRunSessionMock.mockResolvedValue(undefined)
    extendTaskLeaseMock.mockResolvedValue(undefined)
    findTaskByIdAndUserIdMock.mockResolvedValue({ id: 'task-1' })
    markRunSucceededMock.mockResolvedValue(undefined)
    markRunFailedMock.mockResolvedValue(undefined)
    scheduleTaskRetryMock.mockResolvedValue(undefined)
    clearTaskRetryStateMock.mockResolvedValue(undefined)
    releaseTaskLeaseMock.mockResolvedValue(undefined)
    touchActivityMock.mockResolvedValue(undefined)
    createAuditEventMock.mockResolvedValue(undefined)
    ensureProviderAccessFreshForExecutionMock.mockResolvedValue(undefined)
    sendSlackNotificationsMock.mockResolvedValue({ ok: true, sent: 1, failed: 0, errors: [] })
  })

  it('marks a claimed task as succeeded when the session completes cleanly', async () => {
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'session-1' },
        }),
        messages: vi.fn()
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValue({
            data: [
              {
                info: {
                  role: 'assistant',
                  time: { completed: 1 },
                },
                parts: [
                  { id: 'part-1', type: 'text', text: 'Done' },
                ],
              },
            ],
          }),
        promptAsync: vi.fn().mockResolvedValue({ response: { ok: true } }),
        status: vi.fn().mockResolvedValue({
          data: {
            'session-1': { type: 'idle' },
          },
        }),
      },
    })

    const { runClaimedAutopilotTask } = await import('../runner')
    await runClaimedAutopilotTask(buildClaimedTask(), 'schedule')

    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', trigger: 'schedule' })
    )
    expect(attachRunSessionMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ openCodeSessionId: 'session-1' })
    )
    expect(markRunSucceededMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ openCodeSessionId: 'session-1' })
    )
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'autopilot.run_succeeded',
        metadata: expect.objectContaining({
          runId: 'run-1',
          sessionId: 'session-1',
          slug: 'alice',
          taskId: 'task-1',
          trigger: 'schedule',
          userId: 'user-1',
        }),
      })
    )
    expect(releaseTaskLeaseMock).toHaveBeenCalledWith('task-1', 'lease-1', expect.any(Date))
  })

  it('sends Slack notifications after a successful configured run', async () => {
    vi.stubEnv('ARCHE_PUBLIC_BASE_URL', 'https://arche.test')
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'session-1' },
        }),
        messages: vi.fn()
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValue({
            data: [
              {
                info: {
                  role: 'assistant',
                  time: { completed: 1 },
                },
                parts: [
                  { id: 'part-1', type: 'text', text: 'Report text' },
                ],
              },
            ],
          }),
        promptAsync: vi.fn().mockResolvedValue({ response: { ok: true } }),
        status: vi.fn().mockResolvedValue({
          data: {
            'session-1': { type: 'idle' },
          },
        }),
      },
    })

    try {
      const { runClaimedAutopilotTask } = await import('../runner')
      await runClaimedAutopilotTask(
        buildClaimedTask({
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'channel', channelId: 'C123' }],
          },
        }),
        'schedule',
      )

      expect(sendSlackNotificationsMock).toHaveBeenCalledWith({
        targets: [{ type: 'channel', channelId: 'C123' }],
        text: 'Autopilot report: Daily summary\n\nReport text',
        sessionLink: 'https://arche.test/w/alice?mode=tasks&session=session-1',
        source: 'autopilot',
      })
      expect(markRunSucceededMock).toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('records user-scoped audit metadata when a claimed task fails before loading the owner slug', async () => {
    findByIdSelectMock.mockResolvedValue(null)

    const { runClaimedAutopilotTask } = await import('../runner')
    await runClaimedAutopilotTask(buildClaimedTask(), 'schedule')

    expect(markRunFailedMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: 'autopilot_user_not_found' })
    )
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'autopilot.run_failed',
        metadata: expect.objectContaining({
          runId: 'run-1',
          sessionId: null,
          taskId: 'task-1',
          trigger: 'schedule',
          userId: 'user-1',
          error: 'autopilot_user_not_found',
        }),
      })
    )
  })

  it('marks a claimed task as failed when the workspace client is unavailable', async () => {
    createInstanceClientMock.mockResolvedValue(null)

    const { runClaimedAutopilotTask } = await import('../runner')
    const task = buildClaimedTask()
    await runClaimedAutopilotTask(task, 'schedule')

    expect(markRunFailedMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        error: 'instance_unavailable',
        openCodeSessionId: null,
        sessionTitle: null,
      })
    )
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'autopilot.run_failed',
        metadata: expect.objectContaining({
          error: 'instance_unavailable',
          slug: 'alice',
        }),
      })
    )
    expect(scheduleTaskRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAttempt: 1,
        retryScheduledFor: task.scheduledFor,
        taskId: 'task-1',
      })
    )
  })

  it('does not retry manual runs by default', async () => {
    createInstanceClientMock.mockResolvedValue(null)

    const { runClaimedAutopilotTask } = await import('../runner')
    await runClaimedAutopilotTask(buildClaimedTask(), 'manual')

    expect(markRunFailedMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: 'instance_unavailable' })
    )
    expect(scheduleTaskRetryMock).not.toHaveBeenCalled()
  })

  it('uses configured backoff when a scheduled start fails before prompting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T09:00:30.000Z'))
    vi.stubEnv('ARCHE_AUTOPILOT_MAX_START_RETRIES', '3')
    vi.stubEnv('ARCHE_AUTOPILOT_RETRY_BACKOFF_MS', '120000,300000,900000')

    try {
      getInstanceStatusMock.mockResolvedValue(null)
      startInstanceMock.mockResolvedValue({ ok: false, error: 'timeout', detail: 'healthcheck timeout: dns_resolution_error' })

      const task = buildClaimedTask()
      const { runClaimedAutopilotTask } = await import('../runner')
      await runClaimedAutopilotTask(task, 'schedule')

      expect(scheduleTaskRetryMock).toHaveBeenCalledWith({
        leaseOwner: 'lease-1',
        retryAttempt: 1,
        retryAt: new Date('2026-04-12T09:02:30.000Z'),
        retryScheduledFor: task.scheduledFor,
        taskId: 'task-1',
      })
      expect(createAuditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            attempt: 1,
            error: 'healthcheck timeout: dns_resolution_error',
            maxAttempts: 4,
            retryAt: '2026-04-12T09:02:30.000Z',
            willRetry: true,
          }),
        })
      )
    } finally {
      vi.unstubAllEnvs()
      vi.useRealTimers()
    }
  })

  it('marks a claimed task as failed when OpenCode does not create a session', async () => {
    createInstanceClientMock.mockResolvedValue({
      session: {
        create: vi.fn().mockResolvedValue({ data: null }),
      },
    })

    const { runClaimedAutopilotTask } = await import('../runner')
    await runClaimedAutopilotTask(buildClaimedTask(), 'schedule')

    expect(markRunFailedMock).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: 'autopilot_session_create_failed' })
    )
  })

  it('returns task_busy when an immediate run cannot acquire the lease', async () => {
    claimTaskForImmediateRunMock.mockResolvedValue(null)
    findTaskByIdAndUserIdMock.mockResolvedValue({ id: 'task-1' })

    const { triggerAutopilotTaskNow } = await import('../runner')
    const result = await triggerAutopilotTaskNow({
      taskId: 'task-1',
      trigger: 'manual',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'task_busy' })
  })

  it('returns not_found when a user-scoped immediate run targets a missing task', async () => {
    claimTaskForImmediateRunMock.mockResolvedValue(null)
    findTaskByIdAndUserIdMock.mockResolvedValue(null)

    const { triggerAutopilotTaskNow } = await import('../runner')
    const result = await triggerAutopilotTaskNow({
      taskId: 'task-1',
      trigger: 'manual',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns task_busy for unscoped immediate runs that cannot acquire the lease', async () => {
    claimTaskForImmediateRunMock.mockResolvedValue(null)

    const { triggerAutopilotTaskNow } = await import('../runner')
    const result = await triggerAutopilotTaskNow({
      taskId: 'task-1',
      trigger: 'manual',
    })

    expect(result).toEqual({ ok: false, error: 'task_busy' })
    expect(findTaskByIdAndUserIdMock).not.toHaveBeenCalled()
  })

  it('starts an immediate run in the background and logs execution failures', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      claimTaskForImmediateRunMock.mockResolvedValue(buildClaimedTask())
      createRunMock.mockRejectedValue(new Error('create failed'))

      const { triggerAutopilotTaskNow } = await import('../runner')
      const result = await triggerAutopilotTaskNow({
        taskId: 'task-1',
        trigger: 'manual',
        userId: 'user-1',
      })

      await Promise.resolve()
      await Promise.resolve()

      expect(result).toEqual({ ok: true })
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[autopilot] Failed to execute immediate task run',
        expect.objectContaining({
          taskId: 'task-1',
          trigger: 'manual',
          error: expect.any(Error),
        })
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('keeps polling when the session goes idle but the latest assistant message is still pending', async () => {
    vi.useFakeTimers()

    try {
      createInstanceClientMock.mockResolvedValue({
        session: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-1' },
          }),
          messages: vi
            .fn()
            .mockResolvedValueOnce({
              data: [],
            })
            .mockResolvedValueOnce({
              data: [
                {
                  info: {
                    role: 'assistant',
                    time: {},
                  },
                  parts: [
                    {
                      id: 'tool-1',
                      type: 'tool',
                      tool: 'task',
                      state: { status: 'running', input: {}, title: 'working' },
                    },
                  ],
                },
              ],
            })
            .mockResolvedValueOnce({
              data: [
                {
                  info: {
                    role: 'assistant',
                    time: {},
                  },
                  parts: [
                    {
                      id: 'tool-1',
                      type: 'tool',
                      tool: 'task',
                      state: { status: 'running', input: {}, title: 'working' },
                    },
                  ],
                },
              ],
            })
            .mockResolvedValue({
              data: [
                {
                  info: {
                    role: 'assistant',
                    time: { completed: 1 },
                  },
                  parts: [
                    { id: 'part-1', type: 'text', text: 'Done' },
                  ],
                },
              ],
            }),
          promptAsync: vi.fn().mockResolvedValue({ response: { ok: true } }),
          status: vi
            .fn()
            .mockResolvedValueOnce({
              data: {
                'session-1': { type: 'idle' },
              },
            })
            .mockResolvedValueOnce({
              data: {
                'session-1': { type: 'idle' },
              },
            }),
        },
      })

      const { runClaimedAutopilotTask } = await import('../runner')
      const runPromise = runClaimedAutopilotTask(
        buildClaimedTask(),
        'schedule'
      )

      await vi.advanceTimersByTimeAsync(2_000)
      await runPromise

      expect(markRunSucceededMock).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ openCodeSessionId: 'session-1' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails quickly when a session stays idle without assistant output past the grace period', async () => {
    vi.useFakeTimers()

    try {
      createInstanceClientMock.mockResolvedValue({
        session: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-1' },
          }),
          messages: vi.fn().mockResolvedValue({ data: [] }),
          promptAsync: vi.fn().mockResolvedValue({ response: { ok: true } }),
          status: vi.fn().mockResolvedValue({
            data: {
              'session-1': { type: 'idle' },
            },
          }),
        },
      })

      const { runClaimedAutopilotTask } = await import('../runner')
      const runPromise = runClaimedAutopilotTask(
        buildClaimedTask(),
        'schedule'
      )

      await vi.advanceTimersByTimeAsync(16_000)
      await runPromise

      expect(markRunFailedMock).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ error: 'autopilot_no_assistant_message' })
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
