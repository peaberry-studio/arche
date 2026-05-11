/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AutopilotRunHistory } from '@/components/autopilot/autopilot-run-history'
import type { AutopilotTaskDetail } from '@/lib/autopilot/types'

const task: AutopilotTaskDetail = {
  id: 'task-1',
  name: 'Daily summary',
  prompt: 'Summarize work',
  targetAgentId: null,
  cronExpression: '0 9 * * *',
  timezone: 'UTC',
  enabled: true,
  nextRunAt: '2026-01-02T09:00:00.000Z',
  lastRunAt: null,
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
  latestRun: null,
  runs: [],
}

describe('AutopilotRunHistory', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders an empty state when no runs exist', () => {
    render(<AutopilotRunHistory slug="alice" task={task} />)

    expect(screen.getByText('Run history')).toBeTruthy()
    expect(screen.getByText('No runs recorded yet.')).toBeTruthy()
  })

  it('renders run status, errors, and session links', () => {
    render(
      <AutopilotRunHistory
        slug="alice"
        task={{
          ...task,
          runs: [
            {
              id: 'run-1',
              status: 'succeeded',
              trigger: 'manual',
              scheduledFor: '2026-01-02T09:00:00.000Z',
              startedAt: '2026-01-02T09:01:00.000Z',
              finishedAt: '2026-01-02T09:03:00.000Z',
              error: null,
              openCodeSessionId: 'session-1',
              sessionTitle: 'Run session',
            },
            {
              id: 'run-2',
              status: 'failed',
              trigger: 'schedule',
              scheduledFor: '2026-01-03T09:00:00.000Z',
              startedAt: '2026-01-03T09:01:00.000Z',
              finishedAt: '2026-01-03T09:02:00.000Z',
              error: 'Workspace unavailable',
              openCodeSessionId: null,
              sessionTitle: null,
            },
            {
              id: 'run-3',
              status: 'running',
              trigger: 'on_create',
              scheduledFor: '2026-01-04T09:00:00.000Z',
              startedAt: '2026-01-04T09:01:00.000Z',
              finishedAt: null,
              error: null,
              openCodeSessionId: null,
              sessionTitle: null,
            },
          ],
        }}
      />
    )

    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Workspace unavailable')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open session' }).getAttribute('href')).toBe('/w/alice?mode=tasks&session=session-1')
  })
})
