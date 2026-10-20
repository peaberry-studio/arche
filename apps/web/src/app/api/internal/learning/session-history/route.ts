import { NextRequest, NextResponse } from 'next/server'

import { getInternalLearningContext } from '@/app/api/internal/learning/auth'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import {
  clampSessionHistoryBounds,
  getMessageRole,
  getMessageText,
  getSessionId,
  getSessionTitle,
  type SessionHistoryRequest,
} from '@/lib/learning/session-history'
import { isLearningSessionTitle } from '@/lib/learning/session-title'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = await getInternalLearningContext(request)
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const body = (await request.json().catch(() => null)) as SessionHistoryRequest | null
  const { limit, maxMessages } = clampSessionHistoryBounds(body)
  const query = body?.query?.trim().toLowerCase()
  const runtimeResult = await getRuntimeForSlug(context.slug)
  if (!runtimeResult.ok) {
    return NextResponse.json({ error: runtimeResult.error.code }, { status: 503 })
  }
  const client = runtimeResult.data

  const sessionsResult = await client.listSessions({ limit: body?.sessionIds?.length ? 100 : limit })
  if (!sessionsResult.ok) {
    return NextResponse.json({ error: sessionsResult.error.code }, {
      status: sessionsResult.error.code === 'instance_unavailable' ? 503 : 502,
    })
  }
  const requestedIds = new Set(body?.sessionIds ?? [])
  const sessions = sessionsResult.data
    .filter((session) => {
      const id = getSessionId(session)
      const title = getSessionTitle(session)
      if (!id || isLearningSessionTitle(title)) return false
      if (requestedIds.size > 0 && !requestedIds.has(id)) return false
      return query ? title.toLowerCase().includes(query) : true
    })
    .slice(0, limit)

  const responseSessions = []
  for (const session of sessions) {
    const id = getSessionId(session)
    if (!id) continue
    const entry: {
      id: string
      title: string
      messages?: Array<{ role: string; text: string }>
    } = { id, title: getSessionTitle(session) }

    if (body?.includeMessages) {
      const messagesResult = await client.listMessages(id)
      if (!messagesResult.ok) {
        return NextResponse.json({ error: messagesResult.error.code }, {
          status: messagesResult.error.code === 'instance_unavailable' ? 503 : 502,
        })
      }
      entry.messages = messagesResult.data
        .map((message) => ({ role: getMessageRole(message), text: getMessageText(message).slice(0, 4000) }))
        .filter((message) => message.text.trim().length > 0)
        .slice(-maxMessages)
    }

    responseSessions.push(entry)
  }

  return NextResponse.json({ sessions: responseSessions })
}
