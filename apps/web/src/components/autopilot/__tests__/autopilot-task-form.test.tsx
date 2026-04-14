/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AutopilotTaskForm } from '@/components/autopilot/autopilot-task-form'

const pushMock = vi.fn()
const useAgentsCatalogMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (...args: unknown[]) => useAgentsCatalogMock(...args),
}))

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

  it('submits a new task with the builder-generated cron expression', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        task: {
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
})
