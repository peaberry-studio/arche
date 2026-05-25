/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UsageAnalyticsPanel } from '@/components/providers/usage-analytics-panel'

const usageResponses = [
  {
    summary: {
      costUsd: 1.2345,
      errorCount: 2,
      inputTokens: 1000,
      outputTokens: 500,
      requestCount: 12,
      runCount: 4,
    },
  },
  {
    users: [
      {
        costUsd: 1.2345,
        errorCount: 2,
        inputTokens: 1000,
        outputTokens: 500,
        requestCount: 12,
        runCount: 4,
        user: { email: 'alice@example.com', slug: 'alice' },
        userId: 'u1',
      },
    ],
  },
  {
    providers: [
      {
        costUsd: 1.2345,
        credentialSource: 'user',
        errorCount: 2,
        inputTokens: 1000,
        modelId: 'gpt-5.5',
        outputTokens: 500,
        providerId: 'openai',
        requestCount: 12,
        runCount: 4,
        source: 'web',
      },
    ],
  },
  {
    sessions: [
      {
        createdAt: '2026-05-17T10:00:00.000Z',
        durationMs: 3_900_000,
        id: 'session-1',
        lastSeenAt: '2026-05-17T11:05:00.000Z',
        revokedAt: null,
        user: { email: 'alice@example.com', slug: 'alice' },
      },
      {
        createdAt: '2026-05-17T12:00:00.000Z',
        durationMs: 600_000,
        id: 'session-2',
        lastSeenAt: null,
        revokedAt: null,
        user: null,
      },
    ],
  },
  {
    auditEvents: [
      {
        action: 'provider_credential.created',
        actorUser: null,
        createdAt: '2026-05-17T13:00:00.000Z',
        id: 'audit-1',
      },
    ],
  },
]

function mockUsageFetch() {
  return vi.fn((url: string) => {
    const endpoint = url.split('?')[0]
    const index = [
      '/api/u/local/usage/summary',
      '/api/u/local/usage/users',
      '/api/u/local/usage/providers',
      '/api/u/local/usage/sessions',
      '/api/u/local/usage/audit',
    ].indexOf(endpoint)
    return Promise.resolve({
      ok: true,
      json: async () => usageResponses[index],
    })
  })
}

describe('UsageAnalyticsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads usage metrics and reapplies trimmed filters', async () => {
    const fetchMock = mockUsageFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<UsageAnalyticsPanel slug="local" />)

    expect(await screen.findByText('Requests')).toBeTruthy()
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.getByText('1,000')).toBeTruthy()
    expect(screen.getByText('OpenAI')).toBeTruthy()
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('1h 5m')).toBeTruthy()
    expect(screen.getByText('10m')).toBeTruthy()
    expect(screen.getByText('system')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('User id'), { target: { value: ' u1 ' } })
    fireEvent.change(screen.getByPlaceholderText('Provider'), { target: { value: ' openai ' } })
    fireEvent.change(screen.getByPlaceholderText('Model'), { target: { value: ' gpt-5.5 ' } })
    const form = screen.getByRole('button', { name: 'Apply filters' }).closest('form')
    if (!form) throw new Error('usage filter form not found')
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/u/local/usage/summary?modelId=gpt-5.5&providerId=openai&userId=u1',
      { cache: 'no-store' },
    ))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/u/local/usage/audit?modelId=gpt-5.5&providerId=openai&userId=u1',
      { cache: 'no-store' },
    )
  })

  it('renders empty states and load errors', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/summary')) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'forbidden' }) })
      }

      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<UsageAnalyticsPanel slug="local" />)

    expect(await screen.findByText('You do not have permission for this action.')).toBeTruthy()
    expect(screen.getByText('No user usage recorded.')).toBeTruthy()
    expect(screen.getByText('No provider usage recorded.')).toBeTruthy()
    expect(screen.getByText('No sessions found.')).toBeTruthy()
    expect(screen.getByText('No audit events found.')).toBeTruthy()
  })
})
