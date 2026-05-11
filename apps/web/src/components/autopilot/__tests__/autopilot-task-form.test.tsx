/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutopilotTaskForm } from '@/components/autopilot/autopilot-task-form'

const pushMock = vi.fn()
const useAgentsCatalogMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (...args: unknown[]) => useAgentsCatalogMock(...args),
}))

vi.mock('@/components/autopilot/autopilot-run-history', () => ({
  AutopilotRunHistory: () => <div>Run history</div>,
}))

function task(overrides?: Record<string, unknown>) {
  return {
    id: 'task-1',
    name: 'Daily summary',
    prompt: 'Summarize the latest work',
    targetAgentId: null,
    cronExpression: '0 9 */1 * *',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: '2026-04-12T09:00:00.000Z',
    lastRunAt: null,
    createdAt: '2026-04-11T09:00:00.000Z',
    updatedAt: '2026-04-11T09:00:00.000Z',
    latestRun: null,
    runs: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  }
}

function slackTargetsResponse(overrides?: Record<string, unknown>) {
  return jsonResponse({
    channels: [],
    integrationEnabled: false,
    users: [],
    ...overrides,
  })
}

describe('AutopilotTaskForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'assistant', displayName: 'Assistant', isPrimary: true },
        { id: 'researcher', displayName: 'Researcher', isPrimary: false },
      ],
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('submits a new task with the builder-generated cron expression', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: {
              ...task(),
          },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Task name'), {
      target: { value: 'Daily summary' },
    })
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Summarize the latest work' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/u/alice/autopilot',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            cronExpression: '0 9 */1 * *',
            enabled: true,
            name: 'Daily summary',
            prompt: 'Summarize the latest work',
            targetAgentId: null,
            timezone: 'UTC',
          }),
        })
      )
    })

    expect(pushMock).toHaveBeenCalledWith('/u/alice/autopilot/task-1')
  })

  it('loads an existing task for editing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        task: task({
          name: 'Weekly report',
          prompt: 'Prepare the weekly report',
          targetAgentId: 'researcher',
          timezone: 'Europe/Madrid',
          enabled: false,
        }),
      }))
      .mockResolvedValueOnce(slackTargetsResponse()))

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)

    expect(screen.getByText('Loading autopilot task...')).toBeTruthy()
    expect(await screen.findByDisplayValue('Weekly report')).toBeTruthy()
    expect(screen.getByDisplayValue('Prepare the weekly report')).toBeTruthy()
    expect((screen.getByLabelText('Target agent') as HTMLSelectElement).value).toBe('researcher')
    expect(screen.getByDisplayValue('Europe/Madrid')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeTruthy()
    expect(screen.getByText('Run history')).toBeTruthy()
  })

  it('shows a load error and retries loading', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, false))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)

    expect(await screen.findByText('Could not load autopilot task')).toBeTruthy()
    expect(screen.getByText('not_found')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByDisplayValue('Daily summary')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('submits selected agent and disabled state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce(jsonResponse({ task: task({ id: 'task-2' }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Research task' } })
    fireEvent.change(screen.getByLabelText('Target agent'), { target: { value: 'researcher' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Investigate the roadmap' } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual(expect.objectContaining({
      enabled: false,
      targetAgentId: 'researcher',
    }))
  })

  it('adds Slack notification targets to the saved payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(slackTargetsResponse({
        integrationEnabled: true,
        users: [{ id: 'user-1', email: 'alice@test.com', slackLinked: true }],
        channels: [{ channelId: 'C123', name: 'general', isPrivate: false }],
      }))
      .mockResolvedValueOnce(jsonResponse({ task: task({ id: 'task-slack' }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Slack task' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Send a report' } })
    fireEvent.click(await screen.findByLabelText('Slack notifications'))
    fireEvent.change(screen.getByLabelText('Slack DM target'), { target: { value: 'user-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual(
      expect.objectContaining({
        slackNotificationConfig: {
          enabled: true,
          includeSessionLink: true,
          targets: [{ type: 'dm', userId: 'user-1' }],
        },
      }),
    )
  })

  it('shows save fallback and network errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('bad json') } })
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="create" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('save_failed')).toBeTruthy()

    cleanup()
    render(<AutopilotTaskForm slug="alice" mode="create" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('network_error')).toBeTruthy()
  })

  it('saves edits with PATCH and reloads the task', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce(jsonResponse({ task: task({ name: 'Updated' }) }))
      .mockResolvedValueOnce(jsonResponse({ task: task({ name: 'Reloaded' }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)

    await screen.findByDisplayValue('Daily summary')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls[2][0]).toBe('/api/u/alice/autopilot/task-1')
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: 'PATCH' }))
    expect(pushMock).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Reloaded')).toBeTruthy()
  })

  it('clears Slack notification config when editing and disabling notifications', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        task: task({
          slackNotificationConfig: {
            enabled: true,
            includeSessionLink: true,
            targets: [{ type: 'dm', userId: 'user-1' }],
          },
        }),
      }))
      .mockResolvedValueOnce(slackTargetsResponse({
        integrationEnabled: true,
        users: [{ id: 'user-1', email: 'alice@test.com', slackLinked: true }],
      }))
      .mockResolvedValueOnce(jsonResponse({ task: task({ name: 'Updated' }) }))
      .mockResolvedValueOnce(jsonResponse({ task: task({ name: 'Reloaded' }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)

    await screen.findByText('Active targets (1)')
    fireEvent.click(screen.getByLabelText('Slack notifications'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toEqual(
      expect.objectContaining({ slackNotificationConfig: null }),
    )
  })

  it('deletes an existing task or shows delete fallback errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce(jsonResponse({}, true))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)
    await screen.findByDisplayValue('Daily summary')
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/u/alice/autopilot'))
    unmount()

    pushMock.mockClear()
    const failingFetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('bad json') } })
    vi.stubGlobal('fetch', failingFetchMock)

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)
    await screen.findByDisplayValue('Daily summary')
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(await screen.findByText('delete_failed')).toBeTruthy()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('runs a task now and handles run failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce(jsonResponse({}, true))
      .mockResolvedValueOnce(jsonResponse({ task: task({ name: 'After run' }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)
    await screen.findByDisplayValue('Daily summary')
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls[2]).toEqual(['/api/u/alice/autopilot/task-1/run', { method: 'POST' }])
    expect(screen.getByDisplayValue('After run')).toBeTruthy()
    unmount()

    const failingFetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: task() }))
      .mockResolvedValueOnce(slackTargetsResponse())
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('bad json') } })
    vi.stubGlobal('fetch', failingFetchMock)

    render(<AutopilotTaskForm slug="alice" mode="edit" taskId="task-1" />)
    await screen.findByDisplayValue('Daily summary')
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('run_failed')).toBeTruthy()
  })
})
