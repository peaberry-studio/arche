import { NextResponse } from 'next/server'

import { getInstanceUrl } from '@/lib/opencode/client'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from '@/lib/sse-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_INTERVAL_MS = 10_000
const UPSTREAM_CONNECT_TIMEOUT_MS = 8_000

function jsonErrorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

/**
 * Persistent event pipe: re-dispatches the OpenCode /event stream (SSE) to the
 * browser unchanged. Auth + pipe + heartbeat only. No translation, no session
 * family filter, no idle detection. The client reconnects on its own; the BFF
 * never retries toward OpenCode.
 */
export const GET = withAuth<unknown, { slug: string }>(
  { csrf: false },
  async (request, { slug }) => {
    const instance = await instanceService.findCredentialsBySlug(slug)

    if (!instance || !instance.serverPassword || instance.status !== 'running') {
      return jsonErrorResponse(503, 'instance_unavailable')
    }

    const password = decryptPassword(instance.serverPassword)
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    const baseUrl = getInstanceUrl(slug)

    // The timeout bounds the connect only: `AbortSignal.timeout()` would abort
    // the body read too and tear the persistent pipe down every 8s. Once the
    // headers arrive the timer is cleared and the upstream lives until the
    // browser disconnects (request.signal) or OpenCode closes the stream.
    const upstreamController = new AbortController()
    const connectTimer = setTimeout(() => upstreamController.abort(), UPSTREAM_CONNECT_TIMEOUT_MS)

    let upstream: Response
    try {
      upstream = await fetch(`${baseUrl}/event`, {
        headers: {
          Authorization: authHeader,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: upstreamController.signal,
      })
    } catch {
      clearTimeout(connectTimer)
      return jsonErrorResponse(502, 'event_stream_unavailable')
    }

    clearTimeout(connectTimer)

    if (!upstream.ok || !upstream.body) {
      upstreamController.abort()
      return jsonErrorResponse(502, 'event_stream_unavailable')
    }

    const encoder = new TextEncoder()
    const reader = upstream.body.getReader()

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder()
        let parseState = INITIAL_SSE_PARSE_STATE
        let closed = false

        const close = () => {
          if (closed) return
          closed = true
          clearInterval(heartbeat)
          // Release the upstream connection: the browser is gone or the pipe
          // ended. This aborts only this /event fetch, never the OpenCode
          // session itself.
          upstreamController.abort()
          try { controller.close() } catch { /* already closed/errored */ }
        }

        const heartbeat = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
          } catch {
            close()
          }
        }, HEARTBEAT_INTERVAL_MS)

        request.signal.addEventListener('abort', close, { once: true })

        try {
          while (!closed) {
            const { done, value } = await reader.read()
            if (done) break

            const parsed = parseSseChunk(parseState, decoder.decode(value, { stream: true }))
            parseState = parsed.state
            for (const event of parsed.events) {
              if (closed) break
              // Re-emit the OpenCode event unchanged; the client JSON.parses it.
              controller.enqueue(encoder.encode(`data: ${event.data}\n\n`))
            }
          }
        } catch {
          // Downstream aborted or upstream failed: close the response. The
          // client reconnects; this never aborts the OpenCode session.
        } finally {
          close()
          request.signal.removeEventListener('abort', close)
        }
      },
      cancel() {
        // Downstream cancelled: release the upstream /event fetch.
        upstreamController.abort()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  },
)
