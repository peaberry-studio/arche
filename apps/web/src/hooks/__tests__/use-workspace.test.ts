// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckConnectionAction = vi.fn()
const mockListSessionsAction = vi.fn()
const mockCreateSessionAction = vi.fn()
const mockDeleteSessionAction = vi.fn()
const mockUpdateSessionAction = vi.fn()
const mockListMessagesAction = vi.fn()
const mockAbortSessionAction = vi.fn()
const mockLoadFileTreeAction = vi.fn()
const mockReadFileAction = vi.fn()
const mockGetWorkspaceDiffsAction = vi.fn()
const mockListModelsAction = vi.fn()

vi.mock('@/actions/opencode', () => ({
  checkConnectionAction: (...args: unknown[]) => mockCheckConnectionAction(...args),
  listSessionsAction: (...args: unknown[]) => mockListSessionsAction(...args),
  createSessionAction: (...args: unknown[]) => mockCreateSessionAction(...args),
  deleteSessionAction: (...args: unknown[]) => mockDeleteSessionAction(...args),
  updateSessionAction: (...args: unknown[]) => mockUpdateSessionAction(...args),
  listMessagesAction: (...args: unknown[]) => mockListMessagesAction(...args),
  abortSessionAction: (...args: unknown[]) => mockAbortSessionAction(...args),
  loadFileTreeAction: (...args: unknown[]) => mockLoadFileTreeAction(...args),
  readFileAction: (...args: unknown[]) => mockReadFileAction(...args),
  getWorkspaceDiffsAction: (...args: unknown[]) => mockGetWorkspaceDiffsAction(...args),
  listModelsAction: (...args: unknown[]) => mockListModelsAction(...args),
}))

const mockReadWorkspaceFileAction = vi.fn()
const mockWriteWorkspaceFileAction = vi.fn()
const mockDeleteWorkspaceFileAction = vi.fn()
const mockApplyWorkspacePatchAction = vi.fn()
const mockDiscardWorkspaceFileChangesAction = vi.fn()

vi.mock('@/actions/workspace-agent', () => ({
  readWorkspaceFileAction: (...args: unknown[]) => mockReadWorkspaceFileAction(...args),
  writeWorkspaceFileAction: (...args: unknown[]) => mockWriteWorkspaceFileAction(...args),
  deleteWorkspaceFileAction: (...args: unknown[]) => mockDeleteWorkspaceFileAction(...args),
  applyWorkspacePatchAction: (...args: unknown[]) => mockApplyWorkspacePatchAction(...args),
  discardWorkspaceFileChangesAction: (...args: unknown[]) => mockDiscardWorkspaceFileChangesAction(...args),
}))

import { useWorkspace } from '@/hooks/use-workspace'

describe('useWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    let sessionTitle = 'New session - 22:00'

    mockCheckConnectionAction.mockResolvedValue({
      status: 'connected',
      version: '1.0.0',
    })

    mockListSessionsAction.mockImplementation(async () =>
      ({
        ok: true,
        sessions: [
          {
            id: 'session-1',
            title: sessionTitle,
            status: 'idle',
            updatedAt: 'Just now',
          },
        ],
      })
    )

    mockCreateSessionAction.mockResolvedValue({ ok: false, error: 'not_expected' })
    mockDeleteSessionAction.mockResolvedValue({ ok: true })
    mockUpdateSessionAction.mockResolvedValue({ ok: true })
    mockListMessagesAction.mockResolvedValue({ ok: true, messages: [] })
    mockAbortSessionAction.mockResolvedValue({ ok: true })
    mockLoadFileTreeAction.mockResolvedValue({ ok: true, tree: [] })
    mockReadFileAction.mockResolvedValue({ ok: false, error: 'not_found' })
    mockGetWorkspaceDiffsAction.mockResolvedValue({ ok: true, diffs: [] })
    mockListModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: 'opencode',
          providerName: 'OpenCode',
          modelId: 'scene-free',
          modelName: 'Scene Free',
          isDefault: true,
        },
      ],
    })

    mockReadWorkspaceFileAction.mockResolvedValue({ ok: false, error: 'not_supported' })
    mockWriteWorkspaceFileAction.mockResolvedValue({ ok: false, error: 'not_supported' })
    mockDeleteWorkspaceFileAction.mockResolvedValue({ ok: false, error: 'not_supported' })
    mockApplyWorkspacePatchAction.mockResolvedValue({ ok: false, error: 'not_supported' })
    mockDiscardWorkspaceFileChangesAction.mockResolvedValue({ ok: false, error: 'not_supported' })

    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/providers')) {
        return new Response(JSON.stringify({ providers: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.endsWith('/agents')) {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: 'assistant',
                displayName: 'Assistant',
                model: 'opencode/scene-free',
                isPrimary: true,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      }

      if (url.includes('/api/w/alice/chat/stream')) {
        sessionTitle = 'Quick SEO plan'

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: session',
                  'data: {"type":"session.updated","sessionId":"session-1","title":"Quick SEO plan"}',
                  '',
                  'event: done',
                  'data: {"refresh":true}',
                  '',
                  '',
                ].join('\n')
              )
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes sessions when stream emits session updates', async () => {
    const { result } = renderHook(() =>
      useWorkspace({ slug: 'alice', pollInterval: 5000, enabled: true })
    )

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe('session-1')
    })

    expect(result.current.sessions[0]?.title).toBe('New session - 22:00')

    await act(async () => {
      await result.current.sendMessage('hello')
    })

    await waitFor(() => {
      expect(result.current.sessions[0]?.title).toBe('Quick SEO plan')
    })

    expect(mockListSessionsAction.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('uses an available model when primary agent model is missing', async () => {
    mockListModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: 'opencode',
          providerName: 'OpenCode',
          modelId: 'gpt-5-nano',
          modelName: 'GPT-5 Nano',
          isDefault: true,
        },
      ],
    })

    let streamBody: Record<string, unknown> | null = null
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/providers')) {
        return new Response(JSON.stringify({ providers: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.endsWith('/agents')) {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: 'assistant',
                displayName: 'Assistant',
                model: 'opencode/kimi-k2.5-free',
                isPrimary: true,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      }

      if (url.includes('/api/w/alice/chat/stream')) {
        streamBody = JSON.parse(String(init?.body)) as Record<string, unknown>

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: done',
                  'data: {"refresh":true}',
                  '',
                  '',
                ].join('\n')
              )
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useWorkspace({ slug: 'alice', pollInterval: 5000, enabled: true })
    )

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe('session-1')
    })

    await waitFor(() => {
      expect(result.current.agentCatalog.length).toBeGreaterThan(0)
    })

    await act(async () => {
      await result.current.sendMessage('Hola!')
    })

    expect(streamBody).not.toBeNull()
    expect(streamBody?.model).toEqual({
      providerId: 'opencode',
      modelId: 'gpt-5-nano',
    })
  })
})
