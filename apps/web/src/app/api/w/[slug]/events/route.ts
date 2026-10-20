import { NextResponse } from 'next/server'

import type { ArcheEvent } from '@/lib/harness/events'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { withAuth } from '@/lib/runtime/with-auth'
import { subscribeWorkspaceEvents } from '@/lib/runtime/workspace-broadcast'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_INTERVAL_MS = 10_000
const UPSTREAM_CONNECT_TIMEOUT_MS = 8_000

export const GET = withAuth<unknown, { slug: string }>(
  { csrf: false },
  async (request, { slug, user }) => {
    const resolved = await getRuntimeForSlug(slug)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error.code }, { status: 503 })

    const upstreamController = new AbortController()
    const abort = () => upstreamController.abort()
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
    const connectTimer = setTimeout(abort, UPSTREAM_CONNECT_TIMEOUT_MS)
    const upstream = await resolved.data.subscribeEvents(upstreamController.signal)
    clearTimeout(connectTimer)
    if (!upstream.ok) {
      request.signal.removeEventListener('abort', abort)
      abort()
      return NextResponse.json({ error: upstream.error.code === 'instance_unavailable' ? 'instance_unavailable' : 'event_stream_unavailable' }, { status: upstream.error.code === 'instance_unavailable' ? 503 : 502 })
    }

    const encoder = new TextEncoder()
    let close = () => {}
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const heartbeat = setInterval(() => {
          if (closed) return
          try { controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)) } catch { close() }
        }, HEARTBEAT_INTERVAL_MS)
        close = () => {
          if (closed) return
          closed = true
          clearInterval(heartbeat)
          unsubscribeBroadcast?.()
          request.signal.removeEventListener('abort', abort)
          upstreamController.signal.removeEventListener('abort', close)
          abort()
          try { controller.close() } catch { /* already closed */ }
        }
        const send = (event: ArcheEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        const unsubscribeBroadcast = subscribeWorkspaceEvents(user.id, (event) => {
          if (closed || event.type !== 'knowledge.proposals_changed') return
          try { send({ v: 1, type: 'knowledge.proposals_changed' }) } catch { close() }
        })
        upstreamController.signal.addEventListener('abort', close, { once: true })
        if (upstreamController.signal.aborted) close()
        try {
          for await (const event of upstream.data) {
            if (closed) break
            send(event)
          }
        } catch {
          // Stream failure releases this subscription, never session execution.
        } finally {
          close()
        }
      },
      cancel() { close() },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } })
  },
)
