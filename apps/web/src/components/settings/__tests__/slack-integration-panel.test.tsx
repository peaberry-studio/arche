/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'
import type { SlackAgentOption, SlackIntegrationSummary } from '@/lib/slack/types'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

const agents: SlackAgentOption[] = [
  { id: 'assistant', displayName: 'Assistant', isPrimary: true },
  { id: 'researcher', displayName: 'Researcher', isPrimary: false },
]

const disabledIntegration: SlackIntegrationSummary = {
  enabled: false,
  status: 'disabled',
  configured: false,
  hasBotToken: false,
  hasAppToken: false,
  slackTeamId: null,
  slackAppId: null,
  slackBotUserId: null,
  defaultAgentId: null,
  resolvedDefaultAgentId: null,
  lastError: null,
  lastSocketConnectedAt: null,
  lastEventAt: null,
  version: 0,
  updatedAt: null,
}

const connectedIntegration: SlackIntegrationSummary = {
  enabled: true,
  status: 'connected',
  configured: true,
  hasBotToken: true,
  hasAppToken: true,
  slackTeamId: 'T123',
  slackAppId: 'A123',
  slackBotUserId: 'U123',
  defaultAgentId: 'researcher',
  resolvedDefaultAgentId: 'researcher',
  lastError: null,
  lastSocketConnectedAt: 'not-a-date',
  lastEventAt: null,
  version: 3,
  updatedAt: '2026-04-12T09:00:00.000Z',
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function getResponse(integration = disabledIntegration) {
  return jsonResponse({ agents, integration })
}

describe('SlackIntegrationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads collapsed state and expands setup details', async () => {
    fetchMock.mockResolvedValueOnce(getResponse())

    render(<SlackIntegrationPanel slug="alice" />)

    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/slack-integration', { cache: 'no-store' }))
    expect(screen.getByText('Disabled')).toBeTruthy()
    expect(screen.queryByText('Setup')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Slack integration/ }))
    expect(screen.getByText('Setup')).toBeTruthy()
    expect(screen.getByText('Effective agent: None')).toBeTruthy()
  })

  it('enables the integration with token and agent settings', async () => {
    const onMutated = vi.fn()
    fetchMock
      .mockResolvedValueOnce(getResponse())
      .mockResolvedValueOnce(getResponse(connectedIntegration))
      .mockResolvedValueOnce(jsonResponse({ channels: [] }))

    render(<SlackIntegrationPanel slug="alice" collapsible={false} onMutated={onMutated} />)

    fireEvent.change(await screen.findByLabelText('Bot token'), { target: { value: ' xoxb-token ' } })
    fireEvent.change(screen.getByLabelText('App token'), { target: { value: ' xapp-token ' } })
    fireEvent.change(screen.getByLabelText('Default agent'), { target: { value: 'researcher' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/u/alice/slack-integration')
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      appToken: 'xapp-token',
      botToken: 'xoxb-token',
      defaultAgentId: 'researcher',
      enabled: true,
      reconnect: false,
    })
    expect(onMutated).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('Effective agent: Researcher')).toBeTruthy()
    expect((screen.getByLabelText('Bot token') as HTMLInputElement).value).toBe('')
  })

  it('tests credentials and surfaces API errors', async () => {
    fetchMock
      .mockResolvedValueOnce(getResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true, teamId: 'T123', appId: 'A123', botUserId: 'U123', socketUrlAvailable: true }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_bot_token' }, { status: 400 }))

    render(<SlackIntegrationPanel slug="alice" collapsible={false} />)

    await screen.findByLabelText('Bot token')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Test connection succeeded.')).toBeTruthy()
    expect(screen.getByText(/Team: T123 \| App: A123 \| Bot user:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Paste a valid Slack bot token that starts with xoxb-.')).toBeTruthy()
  })

  it('copies YAML and JSON manifests', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    fetchMock.mockResolvedValueOnce(getResponse())

    render(<SlackIntegrationPanel slug="alice" collapsible={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Copy manifest' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(String(writeText.mock.calls[0][0])).toContain('display_information')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy manifest' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(String(writeText.mock.calls[1][0])).toContain('"display_information"')
  })

  it('shows diagnostics, reconnect errors, and disables an enabled integration', async () => {
    const onMutated = vi.fn()
    fetchMock
      .mockResolvedValueOnce(getResponse({ ...connectedIntegration, lastError: 'socket closed' }))
      .mockResolvedValueOnce(jsonResponse({ channels: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_auth' }, { status: 400 }))
      .mockResolvedValueOnce(getResponse(disabledIntegration))

    render(<SlackIntegrationPanel slug="alice" collapsible={false} onMutated={onMutated} />)

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText('T123')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.getByText('socket closed')).toBeTruthy()
    expect(screen.getByLabelText('Bot token')).toBeTruthy()
    expect(screen.getAllByText('(Saved)').length).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(await screen.findByText('Slack rejected one of the provided tokens.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Disable integration' }))
    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      defaultAgentId: 'researcher',
      enabled: false,
      reconnect: false,
    })
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('refreshes and toggles notification channels', async () => {
    fetchMock
      .mockResolvedValueOnce(getResponse(connectedIntegration))
      .mockResolvedValueOnce(jsonResponse({
        channels: [
          {
            id: 'row-1',
            slackTeamId: 'T123',
            channelId: 'C123',
            name: 'general',
            isPrivate: false,
            enabled: true,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ channels: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ channels: [] }))

    render(<SlackIntegrationPanel slug="alice" collapsible={false} />)

    expect(await screen.findByText('general')).toBeTruthy()
    const channelSwitch = screen.getByRole('switch', { name: 'Enable notifications to general' })
    fireEvent.click(channelSwitch)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/u/alice/slack-integration/channels',
      expect.objectContaining({ method: 'PATCH' }),
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh channels' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/slack-integration/channels', { method: 'POST' }))
  })

  it('shows load failures with friendly messages', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'))

    const { unmount } = render(<SlackIntegrationPanel slug="alice" collapsible={false} />)
    expect(await screen.findByText('Only admins can manage the Slack integration.')).toBeTruthy()
    unmount()

    render(<SlackIntegrationPanel slug="alice" collapsible={false} />)
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
  })
})
