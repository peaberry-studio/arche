import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE streaming endpoint for chat messages.
 *
 * Events emitted to client:
 * - status: { status: 'connecting' | 'thinking' | 'reasoning' | 'tool-calling' | 'writing' | 'complete' | 'error', toolName?, detail? }
 * - message: { id, role, sessionId }
 * - part: { messageId, part, delta? }
 * - workspace-updated: { type, path? }
 * - done: { refresh: true } - Stream complete, client should refresh messages
 * - error: { error: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // Authenticate user
  const session = await getAuthenticatedUser()
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Check authorization
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  // Get instance credentials
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { serverPassword: true, status: true }
  })
  
  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return new Response(JSON.stringify({ error: 'instance_unavailable' }), { 
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  // Parse request body
  const body = await request.json()
  const { sessionId, text, model, resume, messageId } = body as {
    sessionId: string
    text?: string
    model?: { providerId: string; modelId: string }
    resume?: boolean
    messageId?: string
  }
  
  if (!sessionId || (!resume && !text)) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const password = decryptPassword(instance.serverPassword)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
  const baseUrl = `http://opencode-${slug}:4096`
  
  // Create SSE stream
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      
      let aborted = false
      
      try {
        sendEvent('status', { status: 'connecting' })
        
        if (!resume) {
          // Start the message (async, non-blocking)
          const promptBody = {
            parts: [{ type: 'text', text }],
            ...(model && { model: { providerID: model.providerId, modelID: model.modelId } })
          }
          
          const promptUrl = `${baseUrl}/session/${sessionId}/prompt_async`
          console.log('[stream] POST to:', promptUrl)
          
          const promptResponse = await fetch(promptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify(promptBody)
          })
          
          console.log('[stream] prompt_async response:', promptResponse.status)
          
          if (!promptResponse.ok) {
            const errorText = await promptResponse.text()
            console.log('[stream] prompt_async error:', errorText)
            sendEvent('error', { error: `Failed to start message: ${errorText}` })
            controller.close()
            return
          }
        }
        
        sendEvent('status', { status: 'thinking' })
        
        // Subscribe to SSE events from OpenCode
        const eventsUrl = `${baseUrl}/event`
        console.log('[stream] Connecting to events:', eventsUrl)
        
        const eventsResponse = await fetch(eventsUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
          }
        })
        
        console.log('[stream] Events connection:', eventsResponse.status)
        
        if (!eventsResponse.ok || !eventsResponse.body) {
          console.log('[stream] Events connection failed')
          sendEvent('error', { error: 'Failed to connect to event stream' })
          controller.close()
          return
        }
        
        const reader = eventsResponse.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        
        // Track state for the assistant response
        let currentStatus: string | null = null
        let currentToolName: string | undefined
        let currentDetail: string | undefined
        let assistantMessageId: string | null = messageId ?? null
        const messageRoles = new Map<string, string>()

        const emitStatus = (status: string, toolName?: string, detail?: string) => {
          if (currentStatus === status && currentToolName === toolName && currentDetail === detail) return
          currentStatus = status
          currentToolName = toolName
          currentDetail = detail
          sendEvent('status', { status, toolName, detail })
        }
        
        console.log('[stream] Starting to read events...')
        
        while (!aborted) {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log('[stream] Event stream ended')
            break
          }
          
          buffer += decoder.decode(value, { stream: true })
          
          // Parse SSE events from buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          let eventData = ''

          for (const line of lines) {
            if (line.startsWith('data:')) {
              eventData = line.slice(5).trim()
            } else if (line === '' && eventData) {
              // End of event, process it
              try {
                const event = JSON.parse(eventData)
                
                // Get sessionID from event
                const eventSessionId =
                  event.properties?.sessionID ||
                  event.properties?.info?.sessionID ||
                  event.properties?.part?.sessionID

                const eventType = typeof event.type === 'string' ? event.type : ''
                const isWorkspaceEvent =
                  eventType === 'file.edited' ||
                  eventType === 'file.created' ||
                  eventType === 'file.deleted' ||
                  eventType === 'todo.updated'
                
                // Filter events for our session only
                if (!isWorkspaceEvent && eventSessionId && eventSessionId !== sessionId) {
                  eventData = ''
                  continue
                }
                
                console.log('[stream] Event:', eventType)
                
                switch (eventType) {
                  // Session status changes
                  case 'session.status': {
                    const status = event.properties?.status
                    console.log('[stream] Session status:', status?.type)

                    if (status?.type === 'busy') {
                      emitStatus('thinking')
                    } else if (status?.type === 'retry') {
                      emitStatus('thinking', undefined, status?.message)
                    } else if (status?.type === 'idle') {
                      console.log('[stream] Session idle, completing')
                      emitStatus('complete')
                      sendEvent('done', { refresh: true })
                      aborted = true
                    }
                    break
                  }

                  case 'session.idle': {
                    console.log('[stream] Session idle event, completing')
                    emitStatus('complete')
                    sendEvent('done', { refresh: true })
                    aborted = true
                    break
                  }

                  case 'session.error': {
                    const error = event.properties?.error
                    console.log('[stream] Session error:', error)
                    emitStatus('error', undefined, error?.data?.message || 'Unknown error')
                    sendEvent('error', { error: error?.data?.message || 'Unknown error' })
                    aborted = true
                    break
                  }

                  case 'message.updated': {
                    const info = event.properties?.info
                    if (!info) break
                    messageRoles.set(info.id, info.role)
                    sendEvent('message', { id: info.id, role: info.role, sessionId: info.sessionID })
                    if (info.role === 'assistant' && !assistantMessageId) {
                      assistantMessageId = info.id
                    }
                    if (info.role === 'assistant') {
                      sendEvent('assistant-meta', {
                        providerID: info.providerID,
                        modelID: info.modelID,
                        agent: info.agent
                      })
                    }
                    break
                  }

                  // Message part updates
                  case 'message.part.updated': {
                    const part = event.properties?.part
                    const delta = event.properties?.delta
                    if (!part) break

                    const partMessageId = part.messageID
                    const knownRole = messageRoles.get(partMessageId)
                    if (!assistantMessageId && knownRole === 'assistant') {
                      assistantMessageId = partMessageId
                    }

                    const isAssistantPart = assistantMessageId
                      ? partMessageId === assistantMessageId
                      : knownRole === 'assistant'

                    sendEvent('part', { messageId: partMessageId, part, delta })

                    if (!isAssistantPart) break

                    switch (part.type) {
                      case 'text': {
                        emitStatus('writing')
                        break
                      }

                      case 'reasoning': {
                        emitStatus('reasoning')
                        break
                      }

                      case 'tool': {
                        const state = part.state
                        const toolName = part.tool || 'unknown'

                        if (state?.status === 'pending' || state?.status === 'running') {
                          emitStatus('tool-calling', toolName, state.title)
                        } else if (state?.status === 'error') {
                          emitStatus('error', toolName, state.error)
                        } else {
                          emitStatus('thinking')
                        }
                        break
                      }

                      case 'step-start': {
                        emitStatus('thinking')
                        break
                      }

                      case 'retry': {
                        emitStatus('thinking')
                        break
                      }

                      case 'agent': {
                        sendEvent('agent', { agent: part.name })
                        break
                      }

                      case 'subtask': {
                        sendEvent('agent', { agent: part.agent })
                        break
                      }
                    }
                    break
                  }

                  case 'file.edited':
                  case 'file.created':
                  case 'file.deleted':
                  case 'todo.updated': {
                    const maybePath =
                      event.properties?.path ||
                      event.properties?.file?.path ||
                      event.properties?.part?.path

                    sendEvent('workspace-updated', {
                      type: eventType,
                      path: typeof maybePath === 'string' ? maybePath : undefined,
                    })
                    break
                  }

                  // Ignore other event types
                  case 'session.updated':
                  case 'session.created':
                    // These are informational, don't need to forward
                    break

                  default:
                    console.log('[stream] Unhandled event type:', eventType)
                }
              } catch {
                console.log('[stream] Failed to parse event:', eventData.substring(0, 100))
              }

              eventData = ''
            }
          }
        }
        
        reader.releaseLock()
        
      } catch (error) {
        console.log('[stream] Error:', error)
        sendEvent('error', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      } finally {
        console.log('[stream] Closing stream')
        controller.close()
      }
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}
