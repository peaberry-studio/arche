import { describe, expect, it } from 'vitest'

import {
  serializeAutopilotTaskListItem,
  serializeAutopilotTaskDetail,
} from '@/lib/autopilot/serializers'
import type {
  AutopilotRunRecord,
  AutopilotTaskDetailRecord,
  AutopilotTaskListRecord,
} from '@/lib/services/autopilot'

function createRunRecord(overrides: Partial<AutopilotRunRecord> = {}): AutopilotRunRecord {
  return {
    id: 'run-1',
    taskId: 'task-1',
    status: 'succeeded',
    trigger: 'schedule',
    scheduledFor: new Date('2026-04-10T09:00:00.000Z'),
    attempt: 1,
    startedAt: new Date('2026-04-10T09:00:05.000Z'),
    finishedAt: new Date('2026-04-10T09:01:00.000Z'),
    error: null,
    openCodeSessionId: 'session-abc',
    sessionTitle: 'Daily summary',
    resultSeenAt: null,
    createdAt: new Date('2026-04-10T09:00:00.000Z'),
    updatedAt: new Date('2026-04-10T09:01:00.000Z'),
    ...overrides,
  }
}

function createTaskListRecord(overrides: Partial<AutopilotTaskListRecord> = {}): AutopilotTaskListRecord {
  return {
    id: 'task-1',
    userId: 'user-1',
    name: 'Daily summary',
    prompt: 'Summarize the latest work',
    targetAgentId: 'assistant',
    cronExpression: '0 9 * * 1-5',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: new Date('2026-04-11T09:00:00.000Z'),
    lastRunAt: new Date('2026-04-10T09:00:00.000Z'),
    leaseOwner: null,
    leaseExpiresAt: null,
    retryAttempt: 0,
    retryScheduledFor: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T09:01:00.000Z'),
    runs: [createRunRecord()],
    ...overrides,
  }
}

describe('serializeAutopilotTaskListItem', () => {
  it('serializes a task with a latest run', () => {
    const task = createTaskListRecord()
    const result = serializeAutopilotTaskListItem(task)

    expect(result).toEqual({
      id: 'task-1',
      name: 'Daily summary',
      prompt: 'Summarize the latest work',
      targetAgentId: 'assistant',
      cronExpression: '0 9 * * 1-5',
      timezone: 'UTC',
      enabled: true,
      nextRunAt: '2026-04-11T09:00:00.000Z',
      lastRunAt: '2026-04-10T09:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-10T09:01:00.000Z',
      latestRun: {
        id: 'run-1',
        status: 'succeeded',
        trigger: 'schedule',
        scheduledFor: '2026-04-10T09:00:00.000Z',
        startedAt: '2026-04-10T09:00:05.000Z',
        finishedAt: '2026-04-10T09:01:00.000Z',
        error: null,
        openCodeSessionId: 'session-abc',
        sessionTitle: 'Daily summary',
      },
    })
  })

  it('serializes a task with no runs', () => {
    const task = createTaskListRecord({
      runs: [],
      lastRunAt: null,
    })
    const result = serializeAutopilotTaskListItem(task)

    expect(result.latestRun).toBeNull()
    expect(result.lastRunAt).toBeNull()
  })

  it('handles a run with no finishedAt', () => {
    const task = createTaskListRecord({
      runs: [createRunRecord({ finishedAt: null, status: 'running' })],
    })
    const result = serializeAutopilotTaskListItem(task)

    expect(result.latestRun).not.toBeNull()
    expect(result.latestRun!.finishedAt).toBeNull()
    expect(result.latestRun!.status).toBe('running')
  })

  it('handles a run with an error', () => {
    const task = createTaskListRecord({
      runs: [createRunRecord({ error: 'timeout', status: 'failed' })],
    })
    const result = serializeAutopilotTaskListItem(task)

    expect(result.latestRun!.error).toBe('timeout')
    expect(result.latestRun!.status).toBe('failed')
  })

  it('handles null openCodeSessionId and sessionTitle', () => {
    const task = createTaskListRecord({
      runs: [createRunRecord({ openCodeSessionId: null, sessionTitle: null })],
    })
    const result = serializeAutopilotTaskListItem(task)

    expect(result.latestRun!.openCodeSessionId).toBeNull()
    expect(result.latestRun!.sessionTitle).toBeNull()
  })
})

describe('serializeAutopilotTaskDetail', () => {
  it('serializes a task with multiple runs', () => {
    const task: AutopilotTaskDetailRecord = {
      ...createTaskListRecord(),
      runs: [
        createRunRecord({ id: 'run-2', trigger: 'manual' }),
        createRunRecord({ id: 'run-1', trigger: 'schedule' }),
      ],
    }
    const result = serializeAutopilotTaskDetail(task)

    expect(result.latestRun).not.toBeNull()
    expect(result.latestRun!.id).toBe('run-2')
    expect(result.runs).toHaveLength(2)
    expect(result.runs[0].id).toBe('run-2')
    expect(result.runs[1].id).toBe('run-1')
  })

  it('serializes a task with no runs', () => {
    const task: AutopilotTaskDetailRecord = {
      ...createTaskListRecord({ runs: [], lastRunAt: null }),
    }
    const result = serializeAutopilotTaskDetail(task)

    expect(result.latestRun).toBeNull()
    expect(result.runs).toEqual([])
  })

  it('includes all task fields alongside runs', () => {
    const task: AutopilotTaskDetailRecord = {
      ...createTaskListRecord({ targetAgentId: null }),
    }
    const result = serializeAutopilotTaskDetail(task)

    expect(result.id).toBe('task-1')
    expect(result.targetAgentId).toBeNull()
    expect(result.cronExpression).toBe('0 9 * * 1-5')
    expect(result.enabled).toBe(true)
    expect(Array.isArray(result.runs)).toBe(true)
  })

  it('serializes Slack notification config when present', () => {
    const task: AutopilotTaskDetailRecord = {
      ...createTaskListRecord({
        slackNotificationConfig: {
          enabled: true,
          includeSessionLink: false,
          targets: [
            { type: 'dm', userId: 'user-1' },
            { type: 'channel', channelId: 'C123' },
          ],
        },
      }),
    }
    const result = serializeAutopilotTaskDetail(task)

    expect(result.slackNotificationConfig).toEqual({
      enabled: true,
      includeSessionLink: false,
      targets: [
        { type: 'dm', userId: 'user-1' },
        { type: 'channel', channelId: 'C123' },
      ],
    })
  })
})
