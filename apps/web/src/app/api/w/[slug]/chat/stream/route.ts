import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptPassword } from '@/lib/spawner/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE streaming endpoint for chat messages.
 * 
 * Flow:
 * 1. Client POSTs with sessionId and message text
 * 2. Server starts the message via promptAsync (non-blocking)
 * 3. Server subscribes to OpenCode SSE events
 * 4. Server forwards relevant events to client as SSE
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  
  // Authenticate user
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const session = await getSessionFromToken(token)
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
      
      let eventSource: EventSource | null = null
      let aborted = false
      
      try {
        // Send initial status
        sendEvent('status', { status: 'connecting' })
        
        // Start the message (async, non-blocking)
        const promptBody = {
          parts: [{ type: 'text', text }],
          ...(model && { model: { providerID: model.providerId, modelID: model.modelId } })
        }
        
        // Use promptAsync endpoint (returns 204 immediately)
        const promptResponse = await fetch(`${baseUrl}/session/${sessionId}/prompt/async`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify(promptBody)
        })
        
        if (!promptResponse.ok) {
          const errorText = await promptResponse.text()
          sendEvent('error', { error: `Failed to start message: ${errorText}` })
          controller.close()
          return
        }
        
        sendEvent('status', { status: 'thinking' })
        
        // Subscribe to SSE events from OpenCode
        const eventsUrl = `${baseUrl}/event`
        
        // Use fetch with streaming for SSE
        const eventsResponse = await fetch(eventsUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
          }
        })
        
        if (!eventsResponse.ok || !eventsResponse.body) {
          sendEvent('error', { error: 'Failed to connect to event stream' })
          controller.close()
          return
        }
        
        const reader = eventsResponse.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentMessageId: string | null = null
        
        while (!aborted) {
          const { done, value } = await reader.read()
          
          if (done) {
            break
          }
          
          buffer += decoder.decode(value, { stream: true })
          
          // Parse SSE events from buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer
          
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
                
                // Filter events for our session
                if (event.properties?.sessionID && event.properties.sessionID !== sessionId) {
                  eventType = ''
                  eventData = ''
                  continue
                }
                
                // Handle different event types
                switch (event.type) {
                  case 'message.part.updated': {
                    const part = event.properties?.part
                    const delta = event.properties?.delta
                    
                    if (!currentMessageId && event.properties?.messageID) {
                      currentMessageId = event.properties.messageID
                      sendEvent('message_start', { messageId: currentMessageId })
                    }
                    
                    if (part) {
                      // Determine status based on part type
                      if (part.type === 'text') {
                        sendEvent('status', { status: 'writing' })
                        sendEvent('text', { text: delta || part.text, messageId: currentMessageId })
                      } else if (part.type === 'reasoning') {
                        sendEvent('status', { status: 'reasoning' })
                        if (part.text) {
                          sendEvent('reasoning', { text: part.text })
                        }
                      } else if (part.type === 'tool') {
                        const toolState = part.state || 'pending'
                        sendEvent('status', { 
                          status: 'tool-calling',
                          toolName: part.tool?.name || part.name,
                          toolState
                        })
                        sendEvent('tool', { 
                          name: part.tool?.name || part.name,
                          state: toolState,
                          input: part.input,
                          output: part.output
                        })
                      } else if (part.type === 'step-start') {
                        sendEvent('status', { status: 'thinking' })
                      } else if (part.type === 'step-finish') {
                        // Step finished, might have more steps
                        sendEvent('step_finish', { 
                          tokens: part.tokens,
                          cost: part.cost
                        })
                      }
                    }
                    break
                  }
                  
                  case 'session.idle': {
                    // Session finished processing
                    sendEvent('status', { status: 'complete' })
                    sendEvent('done', { messageId: currentMessageId })
                    aborted = true
                    break
                  }
                  
                  case 'session.status': {
                    const status = event.properties?.status
                    if (status?.type === 'busy') {
                      sendEvent('status', { status: 'thinking' })
                    } else if (status?.type === 'idle') {
                      sendEvent('status', { status: 'complete' })
                      sendEvent('done', { messageId: currentMessageId })
                      aborted = true
                    }
                    break
                  }
                }
              } catch {
                // Invalid JSON, skip
              }
              
              eventType = ''
              eventData = ''
            }
          }
        }
        
        reader.releaseLock()
        
      } catch (error) {
        sendEvent('error', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      } finally {
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
