import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE streaming endpoint for chat messages.
 *
 * Events emitted to client:
 * - status: { status: 'connecting' | 'thinking' | 'reasoning' | 'tool-calling' | 'writing' | 'complete' | 'error', toolName?, detail? }
 * - text: { text: string } - Incremental text delta
 * - tool: { id, name, status, input?, output?, title? } - Tool invocation update
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
  const { sessionId, text, model } = body as {
    sessionId: string
    text: string
    model?: { providerId: string; modelId: string }
  }
  
  if (!sessionId || !text) {
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
        let lastTextLength = 0
        let currentStatus = 'thinking'
        let assistantMessageId: string | null = null
        
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
          
          let eventType = ''
          let eventData = ''
          
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              eventData = line.slice(5).trim()
            } else if (line === '' && eventData) {
              // End of event, process it
              try {
                const event = JSON.parse(eventData)
                
                // Get sessionID from event
                const eventSessionId = event.properties?.sessionID || event.properties?.info?.sessionID
                
                // Filter events for our session only
                if (eventSessionId && eventSessionId !== sessionId) {
                  eventType = ''
                  eventData = ''
                  continue
                }
                
                console.log('[stream] Event:', event.type)
                
                switch (event.type) {
                  // Session status changes
                  case 'session.status': {
                    const status = event.properties?.status
                    console.log('[stream] Session status:', status?.type)
                    
                    if (status?.type === 'busy' && currentStatus !== 'writing') {
                      currentStatus = 'thinking'
                      sendEvent('status', { status: 'thinking' })
                    } else if (status?.type === 'idle') {
                      console.log('[stream] Session idle, completing')
                      sendEvent('status', { status: 'complete' })
                      sendEvent('done', { refresh: true })
                      aborted = true
                    }
                    break
                  }
                  
                  case 'session.idle': {
                    console.log('[stream] Session idle event, completing')
                    sendEvent('status', { status: 'complete' })
                    sendEvent('done', { refresh: true })
                    aborted = true
                    break
                  }
                  
                  case 'session.error': {
                    const error = event.properties?.error
                    console.log('[stream] Session error:', error)
                    sendEvent('status', { status: 'error', detail: error?.data?.message || 'Unknown error' })
                    sendEvent('error', { error: error?.data?.message || 'Unknown error' })
                    aborted = true
                    break
                  }
                  
                  // Message part updates
                  case 'message.part.updated': {
                    const part = event.properties?.part
                    const delta = event.properties?.delta
                    const messageRole = event.properties?.info?.role
                    const messageId = event.properties?.info?.id
                    
                    if (!part) break
                    
                    // Ignore parts from user messages - only process assistant responses
                    if (messageRole === 'user') {
                      break
                    }
                    
                    // Track the assistant message ID - only process parts from this message
                    // This prevents processing the user's message text
                    if (messageRole === 'assistant' && messageId && !assistantMessageId) {
                      assistantMessageId = messageId
                      console.log('[stream] Tracking assistant message:', assistantMessageId)
                    }
                    
                    // Only process text parts if we've identified the assistant message
                    // and this part belongs to it
                    if (part.type === 'text' && messageId && assistantMessageId && messageId !== assistantMessageId) {
                      console.log('[stream] Skipping text from different message:', messageId)
                      break
                    }
                    
                    switch (part.type) {
                      case 'text': {
                        // Text content from assistant
                        if (currentStatus !== 'writing') {
                          currentStatus = 'writing'
                          sendEvent('status', { status: 'writing' })
                        }
                        
                        // Calculate delta if not provided
                        let textToSend = ''
                        if (delta !== undefined && delta !== null && delta !== '') {
                          textToSend = delta
                        } else if (part.text) {
                          const fullText = String(part.text)
                          textToSend = fullText.slice(lastTextLength)
                          lastTextLength = fullText.length
                        }
                        
                        if (textToSend) {
                          sendEvent('text', { text: textToSend })
                        }
                        break
                      }
                      
                      case 'reasoning': {
                        if (currentStatus !== 'reasoning') {
                          currentStatus = 'reasoning'
                          sendEvent('status', { status: 'reasoning' })
                        }
                        break
                      }
                      
                      case 'tool': {
                        // Tool invocation
                        const state = part.state
                        const toolName = part.tool || 'unknown'
                        
                        if (state?.status === 'pending' || state?.status === 'running') {
                          currentStatus = 'tool-calling'
                          sendEvent('status', { 
                            status: 'tool-calling', 
                            toolName,
                            detail: state.title
                          })
                        }
                        
                        sendEvent('tool', {
                          id: part.callID || part.id,
                          name: toolName,
                          status: state?.status || 'pending',
                          input: state?.input,
                          output: state?.status === 'completed' ? state.output : undefined,
                          title: state?.title
                        })
                        
                        // After tool completes, go back to thinking
                        if (state?.status === 'completed' || state?.status === 'error') {
                          currentStatus = 'thinking'
                          sendEvent('status', { status: 'thinking' })
                        }
                        break
                      }
                      
                      case 'step-start': {
                        // New step starting
                        if (currentStatus !== 'thinking') {
                          currentStatus = 'thinking'
                          sendEvent('status', { status: 'thinking' })
                        }
                        break
                      }
                      
                      case 'step-finish': {
                        // Step finished - might have more steps
                        console.log('[stream] Step finished')
                        break
                      }
                      
                      // Ignore metadata parts that shouldn't be displayed
                      case 'snapshot':
                      case 'patch':
                      case 'compaction':
                      case 'agent':
                      case 'retry':
                        // These are internal parts, don't display
                        break
                      
                      case 'file': {
                        // File attachment - could show in UI
                        console.log('[stream] File part:', part.filename || part.url)
                        break
                      }
                      
                      default:
                        console.log('[stream] Unknown part type:', part.type)
                    }
                    break
                  }
                  
                  // Ignore other event types
                  case 'message.updated':
                  case 'session.updated':
                  case 'session.created':
                  case 'file.edited':
                  case 'todo.updated':
                    // These are informational, don't need to forward
                    break
                    
                  default:
                    console.log('[stream] Unhandled event type:', event.type)
                }
              } catch (parseError) {
                console.log('[stream] Failed to parse event:', eventData.substring(0, 100))
              }
              
              eventType = ''
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
