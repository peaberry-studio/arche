import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockListTasksByUserId = vi.fn()
const mockTriggerAutopilotTaskNow = vi.fn()

vi.mock('@/lib/services', () => ({
  autopilotService: {
    listTasksByUserId: (...args: unknown[]) => mockListTasksByUserId(...args),
  },
}))

vi.mock('@/lib/autopilot/runner', () => ({
  triggerAutopilotTaskNow: (...args: unknown[]) => mockTriggerAutopilotTaskNow(...args),
}))

import {
  listAutopilotTasksForMcp,
  runAutopilotTaskForMcp,
} from '../autopilot'

const user = {
  email: 'alice@example.com',
  id: 'user-1',
  role: 'USER',
  slug: 'alice',
}

describe('Autopilot MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists only tasks for the PAT user without exposing prompts', async () => {
    mockListTasksByUserId.mockResolvedValue([
      {
        id: 'task-1',
        userId: 'user-1',
        name: 'Daily summary',
        prompt: 'Do not expose this prompt',
        targetAgentId: 'assistant',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        nextRunAt: new Date('2026-04-26T09:00:00.000Z'),
        lastRunAt: new Date('2026-04-25T09:00:00.000Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: new Date('2026-04-24T09:00:00.000Z'),
        updatedAt: new Date('2026-04-24T09:00:00.000Z'),
        runs: [
          {
            id: 'run-1',
            taskId: 'task-1',
            status: 'succeeded',
            trigger: 'schedule',
            scheduledFor: new Date('2026-04-25T09:00:00.000Z'),
            startedAt: new Date('2026-04-25T09:00:01.000Z'),
            finishedAt: new Date('2026-04-25T09:00:30.000Z'),
            error: null,
            openCodeSessionId: 'session-1',
            sessionTitle: 'Autopilot | Daily summary',
            resultSeenAt: null,
            createdAt: new Date('2026-04-25T09:00:01.000Z'),
            updatedAt: new Date('2026-04-25T09:00:30.000Z'),
          },
        ],
      },
    ])

    const result = await listAutopilotTasksForMcp({ user })

    expect(mockListTasksByUserId).toHaveBeenCalledWith('user-1')
    expect(result).toEqual({
      ok: true,
      tasks: [
        {
          id: 'task-1',
          name: 'Daily summary',
          enabled: true,
          targetAgentId: 'assistant',
          nextRunAt: '2026-04-26T09:00:00.000Z',
          lastRunAt: '2026-04-25T09:00:00.000Z',
          latestRun: {
            id: 'run-1',
            status: 'succeeded',
            trigger: 'schedule',
            startedAt: '2026-04-25T09:00:01.000Z',
            finishedAt: '2026-04-25T09:00:30.000Z',
            error: null,
          },
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('Do not expose this prompt')
    expect(JSON.stringify(result)).not.toContain('session-1')
  })

  it('runs a task as the PAT user', async () => {
    mockTriggerAutopilotTaskNow.mockResolvedValue({ ok: true })

    const result = await runAutopilotTaskForMcp({ id: 'task-1', user })

    expect(result).toEqual({ ok: true })
    expect(mockTriggerAutopilotTaskNow).toHaveBeenCalledWith({
      taskId: 'task-1',
      trigger: 'manual',
      userId: 'user-1',
    })
  })

  it('returns not_found for a task outside the PAT user', async () => {
    mockTriggerAutopilotTaskNow.mockResolvedValue({ ok: false, error: 'not_found' })

    const result = await runAutopilotTaskForMcp({ id: 'task-from-bob', user })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mockTriggerAutopilotTaskNow).toHaveBeenCalledWith({
      taskId: 'task-from-bob',
      trigger: 'manual',
      userId: 'user-1',
    })
  })

  it('returns task_busy when the task lease is active', async () => {
    mockTriggerAutopilotTaskNow.mockResolvedValue({ ok: false, error: 'task_busy' })

    const result = await runAutopilotTaskForMcp({ id: 'task-1', user })

    expect(result).toEqual({ ok: false, error: 'task_busy' })
  })
})
