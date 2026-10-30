import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startReconnectServe, waitFor, within } from '@/lib/harness/adapters/opencode-v2/__tests__/probe-harness.mjs'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import type { ArcheEvent } from '@/lib/harness/events'
import { parseArcheEvent } from '@/lib/workspace-events/parse-event'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/runtime-connection', () => ({ getInstanceBasicAuth: auth }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: () => ({ csrf: false }) }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => false }))
vi.mock('@/lib/runtime/session', () => ({ getSession: async () => ({ user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' }, sessionId: 's1' }) }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: () => ({ ok: true }) }))
vi.mock('@/lib/runtime/desktop/token', () => ({ DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token', validateDesktopToken: () => true }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: async (slug: string) => ({ ok: true, data: createOpenCodeV2Runtime(slug) }) }))
vi.mock('@/lib/runtime/workspace-broadcast', () => ({ subscribeWorkspaceEvents: () => () => undefined }))

import { GET } from '@/app/api/w/[slug]/events/route'

type Serve = Awaited<ReturnType<typeof startReconnectServe>>

function open(): { controller: AbortController; response: Promise<Response> } {
  const controller = new AbortController()
  return { controller, response: GET(new NextRequest('http://localhost/api/w/alice/events?protocol=arche-v1', { signal: controller.signal }), { params: Promise.resolve({ slug: 'alice' }) }) }
}

function read(response: Response) {
  const frames: Array<{ at: number; heartbeat: boolean; event: ArcheEvent | null }> = []
  const decoder = new TextDecoder()
  let buffer = ''
  const done = (async () => {
    const reader = response.body?.getReader()
    for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader?.read()) {
      buffer += decoder.decode(chunk.value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        frames.push({ at: Date.now(), heartbeat: frame.startsWith(': heartbeat'), event: frame.startsWith('data: ') ? parseArcheEvent(frame.slice(6)) : null })
      }
    }
  })().catch(() => undefined)
  return { frames, done }
}

describe.skipIf(!process.env.OPENCODE_V2_LIVE)('V2 production event subscription through the BFF route against a live isolated 2.x serve', () => {
  let serve: Serve

  beforeAll(async () => {
    serve = await startReconnectServe()
    auth.mockResolvedValue({ baseUrl: serve.baseUrl, authHeader: serve.authHeader })
  }, 60_000)
  afterAll(async () => { await serve?.stop() }, 30_000)

  it('heartbeats a quiet stream, streams live deltas, and closing one subscriber neither interrupts the session nor other subscribers', async () => {
    const first = open()
    const firstResponse = await first.response
    expect(firstResponse.status).toBe(200)
    expect(firstResponse.headers.get('Content-Type')).toBe('text/event-stream')
    const connectedAt = Date.now()
    const a = read(firstResponse)
    await waitFor(() => a.frames.some((frame) => frame.heartbeat), 'heartbeat', 11_000)
    expect((a.frames.find((frame) => frame.heartbeat)?.at ?? Infinity) - connectedAt).toBeLessThanOrEqual(10_500)

    const session = await serve.client.session.create({ title: 'live', agent: 'probe', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: serve.workspace } })
    await serve.client.session.prompt({ sessionID: session.id, text: 'MIXED_PROBE' })
    await within(serve.stub.reached.text.promise, 'text barrier')
    const delta = (frames: typeof a.frames, text: string) => frames.some(({ event }) => event?.type === 'part.delta' && event.sessionId === session.id && event.delta === text)
    await waitFor(() => delta(a.frames, 'Hello '), 'first delta')
    expect(a.frames.some(({ event }) => event?.type === 'message.upserted' && 'message' in event && event.message.role === 'user' && event.message.content === 'MIXED_PROBE')).toBe(true)

    const second = open()
    const b = read(await second.response)
    first.controller.abort()
    await a.done
    serve.stub.release('text')
    await waitFor(() => delta(b.frames, 'fixture'), 'second subscriber delta')
    await waitFor(() => b.frames.some(({ event }) => event?.type === 'session.status' && event.sessionId === session.id && event.status === 'idle'), 'idle event')
    expect(delta(a.frames, 'fixture')).toBe(false)

    const messages = await serve.client.message.list({ sessionID: session.id, order: 'asc' })
    expect(messages.data.find((message) => message.type === 'assistant')).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Hello fixture' })]), time: { completed: expect.any(Number) } })
    expect(await serve.client.session.active()).toEqual({})
    second.controller.abort()
    await b.done
  }, 60_000)

  it('answers 502 event_stream_unavailable when upstream rejects or refuses the connection', async () => {
    auth.mockResolvedValueOnce({ baseUrl: serve.baseUrl, authHeader: 'Basic d3Jvbmc6d3Jvbmc=' })
    const rejected = await open().response
    expect(rejected.status).toBe(502)
    expect(await rejected.json()).toEqual({ error: 'event_stream_unavailable' })
    auth.mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:1', authHeader: serve.authHeader })
    const refused = await open().response
    expect(refused.status).toBe(502)
  }, 30_000)
})
