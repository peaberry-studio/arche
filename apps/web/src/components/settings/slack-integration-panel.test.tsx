/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'

describe('SlackIntegrationPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the detailed Slack test error returned by the API', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agents: [],
          integration: {
            configured: false,
            defaultAgentId: null,
            enabled: false,
            hasAppToken: false,
            hasBotToken: false,
            lastError: null,
            lastEventAt: null,
            lastSocketConnectedAt: null,
            resolvedDefaultAgentId: null,
            slackAppId: null,
            slackBotUserId: null,
            slackTeamId: null,
            status: 'disabled',
            updatedAt: null,
            version: 0,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'slack_test_failed',
          message: 'slack_app_mismatch',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<SlackIntegrationPanel slug="alice" collapsible={false} />)

    expect(await screen.findByRole('button', { name: 'Test connection' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('The bot token and app token belong to different Slack apps.')).toBeTruthy()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/u/alice/slack-integration/test',
        expect.objectContaining({
          body: JSON.stringify({ appToken: undefined, botToken: undefined }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      )
    })
  })
})
