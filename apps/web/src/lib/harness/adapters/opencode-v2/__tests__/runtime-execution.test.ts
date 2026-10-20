import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantSnapshot, SESSION_ID, userSnapshot } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import {
  abortSessionFamilyAndConfirmIdle,
  captureSessionMessageCursor,
  createSessionPromptRun,
  describeLatestAssistantReply,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/harness/execution'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createRun: vi.fn(), touch: vi.fn(), usage: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/connection-resolver', () => ({
  getInstanceBasicAuth: mocks.auth,
  getInstanceUrl: (_slug: string, baseUrl?: string) => baseUrl ?? 'http://runtime',
}))
vi.mock('@/lib/harness/registry', () => ({ syncRuntimeProviderAccess: vi.fn() }))
vi.mock('@/lib/runtime/workspace-host', () => ({ getWorkspaceStatus: vi.fn(), startWorkspace: vi.fn() }))
vi.mock('@/lib/services', () => ({
  instanceService: { touchActivity: mocks.touch },
  messageRunService: { createActiveRunAfterRuntimeStateCheck: mocks.createRun },
}))
vi.mock('@/lib/providers/run-usage', () => ({ recordProviderRunUsageBestEffort: mocks.usage }))

type NativeMessage = typeof assistantSnapshot | typeof userSnapshot

function nativeTransport(messages: NativeMessage[] = []) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const children: Record<string, string[]> = { [SESSION_ID]: ['child'], child: ['grandchild'], grandchild: [] }
  const inbox = new Set([SESSION_ID, 'child', 'grandchild'])
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input)
    const method = options.method ?? 'GET'
    expect(new Headers(options.headers).get('Authorization')).toBe('Basic fixture-only')
    calls.push({ method, path: url.pathname, body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined })
    if (url.pathname === '/api/location') return Response.json({ directory: '/workspace' })
    if (url.pathname === '/api/session') {
      const parent = url.searchParams.get('parentID') ?? ''
      const data = url.searchParams.has('cursor') ? [] : (children[parent] ?? []).map((id) => ({ id, parentID: parent, time: { created: 1, updated: 2 } }))
      return Response.json({ data, cursor: { next: data.length ? 'end' : null, previous: null } })
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)(.*)$/)
    if (!match) throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    const [, id, suffix] = match
    if (!(id in children)) return Response.json({ _tag: 'SessionNotFoundError', message: 'Missing fixture session' }, { status: 404 })
    if (!suffix) return Response.json({ data: { id, time: { created: 1, updated: 2 }, agent: 'probe', model: { providerID: 'fixture', id: 'fixture' } } })
    if (suffix === '/message') return Response.json({ data: messages, cursor: { next: null, previous: null } })
    if (suffix === '/prompt') return Response.json({ data: { id: 'msg_current', type: 'user', text: 'Current input' } })
    if (suffix === '/interrupt') return Response.json({ interrupted: true })
    if (suffix === '/inbox') return Response.json({ data: inbox.has(id) ? [{ id: `queued_${id}`, type: 'user', text: 'Pending input' }] : [] })
    if (suffix === `/inbox/queued_${id}` && method === 'DELETE') {
      inbox.delete(id)
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }))
  return { calls, messages, inbox }
}

describe('V2 primitives in shared execution (real adapter and matched HTTP client)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' })
    mocks.touch.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('captures the cursor before prompt and reads only the new assistant reply and its accounting', async () => {
    const transport = nativeTransport([assistantSnapshot])
    const runtime = createOpenCodeV2Runtime('alice')
    const cursor = await captureSessionMessageCursor(runtime, SESSION_ID)
    expect(cursor).toEqual({ messageCount: 1 })
    expect(await runtime.prompt({ sessionId: SESSION_ID, messageId: 'msg_current', parts: [{ type: 'text', text: 'Current input' }] })).toEqual({ ok: true, data: undefined })
    transport.messages.push(userSnapshot, { ...assistantSnapshot, id: 'msg_latest', content: [{ type: 'text', text: 'Latest reply' }] })
    expect(await readLatestAssistantText(runtime, SESSION_ID, cursor)).toBe('Latest reply')
    expect(await describeLatestAssistantReply({ client: runtime, sessionId: SESSION_ID, cursor })).toMatchObject({ assistantMessageCount: 1, messageCount: 2, modelId: 'fixture', providerId: 'fixture', partTypes: ['step-finish', 'text'] })
    expect(await runtime.listMessages(SESSION_ID)).toMatchObject({ ok: true, data: expect.arrayContaining([
      expect.objectContaining({ id: 'msg_latest', parts: expect.arrayContaining([{ type: 'step-finish', id: 'msg_latest:usage', reason: 'stop', cost: 0.000017, tokens: { input: 11, output: 3 } }]) }),
    ]) })
    expect(transport.calls.find((call) => call.path.endsWith('/prompt'))?.body).toEqual({ id: 'msg_current', text: 'Current input' })
  })

  it('does not create a message run from an unverified family-idle assumption', async () => {
    const { calls } = nativeTransport()
    expect(await createSessionPromptRun({ client: createOpenCodeV2Runtime('alice'), sessionId: SESSION_ID, slug: 'alice', source: 'flow' })).toEqual({ ok: false, error: 'session_busy', activeRun: null })
    expect(calls.filter((call) => call.path === '/api/session')).toHaveLength(5)
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(calls.some((call) => call.path.endsWith('/prompt'))).toBe(false)
  })

  it('preserves missing-root errors through execution without creating a run', async () => {
    nativeTransport()
    expect(await createSessionPromptRun({ client: createOpenCodeV2Runtime('alice'), sessionId: 'missing', slug: 'alice', source: 'flow' })).toEqual({ ok: false, error: 'session_not_found' })
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it('interrupts and cancels nested family queues leaf-first but never reports family-idle success', async () => {
    vi.useFakeTimers()
    const { calls, inbox } = nativeTransport()
    const pending = abortSessionFamilyAndConfirmIdle({ client: createOpenCodeV2Runtime('alice'), rootSessionId: SESSION_ID })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toBe(false)
    expect(calls.filter((call) => call.path.endsWith('/interrupt')).map((call) => call.path)).toEqual([
      '/api/session/grandchild/interrupt', '/api/session/child/interrupt', `/api/session/${SESSION_ID}/interrupt`,
    ])
    expect(inbox.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not book usage or successful completion while V2 idle confirmation remains unverified', async () => {
    nativeTransport([userSnapshot, assistantSnapshot])
    await expect(waitForSessionToComplete({ client: createOpenCodeV2Runtime('alice'), sessionId: SESSION_ID, slug: 'alice', usage: { messageRunId: 'run', userId: 'user', source: 'flow' } })).rejects.toThrow('runtime_unsupported')
    expect(mocks.usage).not.toHaveBeenCalled()
  })
})
