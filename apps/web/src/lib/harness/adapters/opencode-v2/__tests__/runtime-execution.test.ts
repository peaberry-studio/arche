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
vi.mock('@/lib/harness/runtime-connection', () => ({
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

type NativeState = {
  active: Set<string>
  children: Record<string, string[]>
  inbox: Record<string, string[]>
  messages: NativeMessage[]
  // Sessions that keep running whatever interrupt says.
  unstoppable: Set<string>
  onInterrupt?: (id: string) => void
  onPrompt?: (id: string, body: unknown) => void
  onCancel?: (id: string, item: string) => void
}

// A stateful stand-in for the 2.0.32 HTTP surface: the real adapter and the
// real `@opencode/client` run on top of it; only `fetch` is replaced.
function nativeTransport(overrides: Partial<NativeState> = {}) {
  const state: NativeState = {
    active: new Set(),
    children: { [SESSION_ID]: ['child'], child: ['grandchild'], grandchild: [] },
    inbox: {},
    messages: [],
    unstoppable: new Set(),
    ...overrides,
  }
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input)
    const method = options.method ?? 'GET'
    expect(new Headers(options.headers).get('Authorization')).toBe('Basic fixture-only')
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
    calls.push({ method, path: url.pathname, body })
    if (url.pathname === '/api/location') return Response.json({ directory: '/workspace' })
    if (url.pathname === '/api/session/active') return Response.json({ data: Object.fromEntries([...state.active].map((id) => [id, { type: 'running' }])) })
    if (url.pathname === '/api/session') {
      const parent = url.searchParams.get('parentID') ?? ''
      const data = url.searchParams.has('cursor') ? [] : (state.children[parent] ?? []).map((id) => ({ id, parentID: parent, time: { created: 1, updated: 2 } }))
      return Response.json({ data, cursor: { next: data.length ? 'end' : null, previous: null } })
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)(.*)$/)
    if (!match) throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    const [, id, suffix] = match
    if (!(id in state.children)) return Response.json({ _tag: 'SessionNotFoundError', message: 'Missing fixture session' }, { status: 404 })
    if (!suffix) return Response.json({ data: { id, time: { created: 1, updated: 2 }, agent: 'probe', model: { providerID: 'fixture', id: 'fixture' } } })
    if (suffix === '/message') return Response.json({ data: state.messages, cursor: { next: null, previous: null } })
    if (suffix === '/prompt') {
      state.onPrompt?.(id, body)
      return Response.json({ data: { id: body.id ?? 'msg_current', sessionID: id, type: 'user', time: { created: 5 }, payload: { text: body.text }, delivery: 'steer' } })
    }
    if (suffix === '/interrupt') {
      const interrupted = state.active.has(id)
      if (!state.unstoppable.has(id)) state.active.delete(id)
      state.onInterrupt?.(id)
      return Response.json({ interrupted })
    }
    if (suffix === '/inbox') return Response.json({ data: (state.inbox[id] ?? []).map((item) => ({ id: item, sessionID: id, type: 'user', time: { created: 1 }, payload: { text: 'Pending input' }, delivery: 'queue' })) })
    const cancel = suffix.match(/^\/inbox\/(.+)$/)
    if (cancel && method === 'DELETE') {
      state.inbox[id] = (state.inbox[id] ?? []).filter((item) => item !== cancel[1])
      state.onCancel?.(id, cancel[1])
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }))
  return { calls, state }
}

const interrupts = (calls: Array<{ path: string }>) => calls.filter((call) => call.path.endsWith('/interrupt')).map((call) => call.path.split('/')[3])

describe('V2 primitives in shared execution (real adapter and matched HTTP client)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' })
    mocks.touch.mockResolvedValue(undefined)
    mocks.createRun.mockImplementation(async (input: { readRuntimeSessionState: () => Promise<string> }) => (
      await input.readRuntimeSessionState() === 'idle' ? { ok: true, run: { id: 'run-1' } } : { ok: false, error: 'session_busy', activeRun: null }
    ))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('captures the cursor before prompt and reads only the new assistant reply and its accounting', async () => {
    const { calls, state } = nativeTransport({ messages: [assistantSnapshot] })
    const runtime = createOpenCodeV2Runtime('alice')
    const cursor = await captureSessionMessageCursor(runtime, SESSION_ID)
    expect(cursor).toEqual({ messageCount: 1 })
    expect(await runtime.prompt({ sessionId: SESSION_ID, messageId: 'msg_current', parts: [{ type: 'text', text: 'Current input' }] })).toEqual({ ok: true, data: undefined })
    state.messages.push(userSnapshot, { ...assistantSnapshot, id: 'msg_latest', content: [{ type: 'text', text: 'Latest reply' }] })
    expect(await readLatestAssistantText(runtime, SESSION_ID, cursor)).toBe('Latest reply')
    expect(await describeLatestAssistantReply({ client: runtime, sessionId: SESSION_ID, cursor })).toMatchObject({ assistantMessageCount: 1, messageCount: 2, modelId: 'fixture', providerId: 'fixture', partTypes: ['step-finish', 'text'] })
    expect(calls.find((call) => call.path.endsWith('/prompt'))?.body).toEqual({ id: 'msg_current', text: 'Current input' })
  })

  it('admits a run when the whole discovered family is inactive', async () => {
    const { calls } = nativeTransport()
    expect(await createSessionPromptRun({ client: createOpenCodeV2Runtime('alice'), sessionId: SESSION_ID, slug: 'alice', source: 'flow' })).toEqual({ ok: true, run: { id: 'run-1' } })
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ slug: 'alice', sessionId: SESSION_ID, source: 'flow' }))
    expect(calls.filter((call) => call.path === '/api/session').map((call) => call.method)).toHaveLength(10)
    expect(calls.some((call) => call.path.endsWith('/prompt'))).toBe(false)
  })

  it('refuses with session_busy and creates no run while a grandchild drain is active', async () => {
    nativeTransport({ active: new Set(['grandchild']) })
    expect(await createSessionPromptRun({ client: createOpenCodeV2Runtime('alice'), sessionId: SESSION_ID, slug: 'alice', source: 'flow' })).toEqual({ ok: false, error: 'session_busy', activeRun: null })
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it('preserves missing-root errors through execution without creating a run', async () => {
    nativeTransport()
    expect(await createSessionPromptRun({ client: createOpenCodeV2Runtime('alice'), sessionId: 'missing', slug: 'alice', source: 'flow' })).toEqual({ ok: false, error: 'session_not_found' })
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it('stops a parent and two busy children leaf-first, cancels queued input and confirms the family idle', async () => {
    const { calls, state } = nativeTransport({
      active: new Set([SESSION_ID, 'child-a', 'child-b']),
      children: { [SESSION_ID]: ['child-a', 'child-b'], 'child-a': [], 'child-b': [] },
      inbox: { [SESSION_ID]: ['queued_root'] },
    })
    expect(await abortSessionFamilyAndConfirmIdle({ client: createOpenCodeV2Runtime('alice'), rootSessionId: SESSION_ID })).toBe(true)
    expect(interrupts(calls)).toEqual(['child-b', 'child-a', SESSION_ID])
    expect(state.active.size).toBe(0)
    expect(state.inbox[SESSION_ID]).toEqual([])
  })

  it('yields unconfirmed termination when a child never stops before the deadline', async () => {
    vi.useFakeTimers()
    const { calls } = nativeTransport({
      active: new Set([SESSION_ID, 'child-a', 'child-b']),
      children: { [SESSION_ID]: ['child-a', 'child-b'], 'child-a': [], 'child-b': [] },
      unstoppable: new Set(['child-b']),
    })
    const pending = abortSessionFamilyAndConfirmIdle({ client: createOpenCodeV2Runtime('alice'), rootSessionId: SESSION_ID })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toBe(false)
    expect(interrupts(calls).slice(0, 3)).toEqual(['child-b', 'child-a', SESSION_ID])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries an abort whose queued input reappears instead of confirming from an empty active map', async () => {
    const { calls, state } = nativeTransport({ children: { [SESSION_ID]: [] }, inbox: { [SESSION_ID]: ['queued_first'] } })
    state.onCancel = (id, item) => {
      if (item === 'queued_first') state.inbox[id] = ['queued_late']
    }
    expect(await abortSessionFamilyAndConfirmIdle({ client: createOpenCodeV2Runtime('alice'), rootSessionId: SESSION_ID })).toBe(true)
    expect(interrupts(calls)).toEqual([SESSION_ID, SESSION_ID])
    expect(state.inbox[SESSION_ID]).toEqual([])
  })

  it('aborts a descendant discovered only after the first family pass', async () => {
    const { calls, state } = nativeTransport({ active: new Set([SESSION_ID]), children: { [SESSION_ID]: [] } })
    state.onInterrupt = (id) => {
      if (id === SESSION_ID && !state.children.late) {
        state.children[SESSION_ID] = ['late']
        state.children.late = []
        state.active.add('late')
      }
    }
    expect(await abortSessionFamilyAndConfirmIdle({ client: createOpenCodeV2Runtime('alice'), rootSessionId: SESSION_ID })).toBe(true)
    expect(interrupts(calls)).toEqual([SESSION_ID, 'late'])
    expect(state.active.size).toBe(0)
  })

  it('settles a completed run and books its per-message usage once the root drain ends', async () => {
    const { state } = nativeTransport({ active: new Set([SESSION_ID]), messages: [userSnapshot] })
    const runtime = createOpenCodeV2Runtime('alice')
    const cursor = await captureSessionMessageCursor(runtime, SESSION_ID)
    vi.useFakeTimers()
    const pending = waitForSessionToComplete({ client: runtime, cursor, sessionId: SESSION_ID, slug: 'alice', usage: { messageRunId: 'run-1', userId: 'user-1', source: 'flow' } })
    await vi.advanceTimersByTimeAsync(2_000)
    state.messages.push(userSnapshot, { ...assistantSnapshot, model: { ...assistantSnapshot.model, providerID: 'openai' } })
    state.active.clear()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await pending).toEqual({ status: 'completed' })
    expect(mocks.usage).toHaveBeenCalledOnce()
    expect(mocks.usage).toHaveBeenCalledWith({
      costUsd: 0.000017, inputTokens: 11, outputTokens: 3, messageRunId: 'run-1', modelId: 'fixture', providerId: 'openai', source: 'flow', userId: 'user-1',
    }, '[harness/execution]')
  })

  it('returns the synchronous reply after the prompt drains and the family is idle', async () => {
    const { state } = nativeTransport({ messages: [userSnapshot] })
    state.onPrompt = () => {
      state.messages.push(userSnapshot, { ...assistantSnapshot, id: 'msg_reply', content: [{ type: 'text', text: 'Synchronous reply' }] })
    }
    const result = await createOpenCodeV2Runtime('alice').sendMessage({ sessionId: SESSION_ID, messageId: 'msg_sync', parts: [{ type: 'text', text: 'Question' }] })
    expect(result).toMatchObject({ ok: true, data: { id: 'msg_reply', role: 'assistant', content: 'Synchronous reply' } })
  })

  it('returns the queued user input for a synchronous no-reply submission without waiting for a reply', async () => {
    const { calls } = nativeTransport()
    const result = await createOpenCodeV2Runtime('alice').sendMessage({ sessionId: SESSION_ID, messageId: 'msg_note', noReply: true, parts: [{ type: 'text', text: 'Context' }] })
    expect(result).toMatchObject({ ok: true, data: { id: 'msg_note', role: 'user', content: 'Context' } })
    expect(calls.find((call) => call.path.endsWith('/prompt'))?.body).toEqual({ id: 'msg_note', text: 'Context', resume: false })
    expect(calls.some((call) => call.path === '/api/session/active')).toBe(false)
  })
})
