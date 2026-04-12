/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AutopilotPage } from '@/components/autopilot/autopilot-page'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

describe('AutopilotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tasks loaded from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [
          {
            id: 'task-1',
            name: 'Daily summary',
            prompt: 'Summarize the latest work',
            targetAgentId: null,
            cronExpression: '0 9 * * *',
            timezone: 'UTC',
            enabled: true,
            nextRunAt: '2026-04-12T09:00:00.000Z',
            lastRunAt: null,
            createdAt: '2026-04-11T09:00:00.000Z',
            updatedAt: '2026-04-11T09:00:00.000Z',
            latestRun: null,
          },
        ],
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotPage slug="alice" />)

    expect(await screen.findByText('Daily summary')).toBeTruthy()
    expect(screen.getByText('0 9 * * *')).toBeTruthy()
    expect(screen.getByText('Primary agent')).toBeTruthy()
    expect(screen.getByRole('link', { name: /daily summary/i }).getAttribute('href')).toBe('/u/alice/autopilot/task-1')
  })

  it('sends a PATCH request when toggling a task', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: 'task-1',
              name: 'Daily summary',
              prompt: 'Summarize the latest work',
              targetAgentId: null,
              cronExpression: '0 9 * * *',
              timezone: 'UTC',
              enabled: true,
              nextRunAt: '2026-04-12T09:00:00.000Z',
              lastRunAt: null,
              createdAt: '2026-04-11T09:00:00.000Z',
              updatedAt: '2026-04-11T09:00:00.000Z',
              latestRun: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: 'task-1',
              name: 'Daily summary',
              prompt: 'Summarize the latest work',
              targetAgentId: null,
              cronExpression: '0 9 * * *',
              timezone: 'UTC',
              enabled: false,
              nextRunAt: '2026-04-12T09:00:00.000Z',
              lastRunAt: null,
              createdAt: '2026-04-11T09:00:00.000Z',
              updatedAt: '2026-04-11T09:00:00.000Z',
              latestRun: null,
            },
          ],
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotPage slug="alice" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/u/alice/autopilot/task-1',
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })

  it('surfaces run-now errors from the list page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: 'task-1',
              name: 'Daily summary',
              prompt: 'Summarize the latest work',
              targetAgentId: null,
              cronExpression: '0 9 * * *',
              timezone: 'UTC',
              enabled: true,
              nextRunAt: '2026-04-12T09:00:00.000Z',
              lastRunAt: null,
              createdAt: '2026-04-11T09:00:00.000Z',
              updatedAt: '2026-04-11T09:00:00.000Z',
              latestRun: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'task_busy' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<AutopilotPage slug="alice" />)

    const [runNowButton] = await screen.findAllByRole('button', { name: 'Run now' })
    fireEvent.click(runNowButton)

    expect(await screen.findByText('Could not complete autopilot action')).toBeTruthy()
    expect(screen.getByText('task_busy')).toBeTruthy()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/u/alice/autopilot/task-1/run',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
