import { createServer } from 'node:http'
import { URL } from 'node:url'

const port = Number.parseInt(process.env.ARCHE_E2E_FAKE_PROVIDER_PORT ?? '4211', 10)
const host = process.env.ARCHE_E2E_FAKE_PROVIDER_HOST ?? '127.0.0.1'
const apiKey = process.env.ARCHE_E2E_FAKE_PROVIDER_API_KEY ?? 'sk-e2e-fake-provider'
const PDF_TOKEN = 'ARCHE_E2E_PDF_TOKEN'

let nextId = 1

function generateId(prefix) {
  return `${prefix}_e2e_${nextId++}`
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function requireAuth(req, res) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
    sendJson(res, 401, { error: { message: 'Invalid API key', type: 'authentication_error' } })
    return false
  }
  return true
}

function extractTextFromPart(part) {
  if (typeof part === 'string') return part
  if (part && typeof part.text === 'string') return part.text
  if (part && part.text && typeof part.text === 'object' && typeof part.text.value === 'string') {
    return part.text.value
  }
  if (part && typeof part.value === 'string') return part.value
  if (part && typeof part.content === 'string') return part.content
  if (part && Array.isArray(part.content)) {
    return part.content.map(extractTextFromPart).filter(Boolean).join('\n')
  }
  if (part && Array.isArray(part.parts)) {
    return part.parts.map(extractTextFromPart).filter(Boolean).join('\n')
  }
  if (part && Array.isArray(part.input)) {
    return part.input.map(extractTextFromPart).filter(Boolean).join('\n')
  }
  // OpenAI Responses API content items: input_text, output_text, text, etc.
  if (part && typeof part.type === 'string' && /text|input_text|output_text/.test(part.type) && typeof part.text === 'string') {
    return part.text
  }
  return ''
}

function extractTextFromMessage(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content.map(extractTextFromPart).filter(Boolean).join('\n')
  }
  // Some Responses API shapes wrap the actual payload under 'content' as a single object
  if (msg.content && typeof msg.content === 'object') {
    return extractTextFromPart(msg.content)
  }
  return extractTextFromPart(msg)
}

function extractPrompt(body) {
  if (!body || typeof body !== 'object') return ''

  if (typeof body.input === 'string') return body.input

  if (body.input && typeof body.input === 'object' && !Array.isArray(body.input)) {
    return extractTextFromPart(body.input)
  }

  if (Array.isArray(body.input)) {
    return body.input.map(extractTextFromMessage).filter(Boolean).join('\n')
  }

  if (typeof body.instructions === 'string') {
    return body.instructions
  }

  if (Array.isArray(body.messages)) {
    return body.messages.map(extractTextFromMessage).filter(Boolean).join('\n')
  }

  return ''
}

function buildReply(prompt) {
  if (prompt.includes(PDF_TOKEN)) {
    return `PDF_OK: ${PDF_TOKEN}`
  }
  return `E2E_OK: ${prompt}`
}

function handleModels(_req, res) {
  sendJson(res, 200, {
    object: 'list',
    data: [
      {
        id: 'gpt-5.2',
        object: 'model',
        created: now(),
        owned_by: 'e2e',
      },
    ],
  })
}

async function handleResponses(req, res) {
  const raw = (await readBody(req)).toString('utf8') || '{}'
  const body = JSON.parse(raw)
  const prompt = extractPrompt(body)
  const reply = buildReply(prompt)

  if (body.stream) {
    const responseId = generateId('resp')
    const messageId = generateId('msg')
    const model = body.model || 'gpt-5.2'
    const responsePayload = {
      id: responseId,
      object: 'response',
      created_at: now(),
      status: 'completed',
      model,
      output: [
        {
          type: 'message',
          id: messageId,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: reply, annotations: [] }],
        },
      ],
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const events = [
      {
        event: 'response.created',
        data: {
          type: 'response.created',
          sequence_number: 0,
          response: {
            id: responseId,
            object: 'response',
            created_at: now(),
            status: 'in_progress',
            model,
            output: [],
          },
        },
      },
      {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          sequence_number: 1,
          output_index: 0,
          item: {
            type: 'message',
            id: messageId,
            role: 'assistant',
            status: 'in_progress',
            content: [],
          },
        },
      },
      {
        event: 'response.content_part.added',
        data: {
          type: 'response.content_part.added',
          sequence_number: 2,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: {
            type: 'output_text',
            text: '',
            annotations: [],
          },
        },
      },
      {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          sequence_number: 3,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta: reply,
        },
      },
      {
        event: 'response.output_text.done',
        data: {
          type: 'response.output_text.done',
          sequence_number: 4,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          text: reply,
        },
      },
      {
        event: 'response.content_part.done',
        data: {
          type: 'response.content_part.done',
          sequence_number: 5,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: {
            type: 'output_text',
            text: reply,
            annotations: [],
          },
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          sequence_number: 6,
          output_index: 0,
          item: {
            type: 'message',
            id: messageId,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: reply, annotations: [] }],
          },
        },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          sequence_number: 7,
          response: responsePayload,
        },
      },
    ]

    for (const { event, data } of events) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    res.write('event: done\ndata: [DONE]\n\n')
    res.end()
    return
  }

  const responseId = generateId('resp')
  const messageId = generateId('msg')
  sendJson(res, 200, {
    id: responseId,
    object: 'response',
    created_at: now(),
    status: 'completed',
    model: body.model || 'gpt-5.2',
    output: [
      {
        type: 'message',
        id: messageId,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: reply, annotations: [] }],
      },
    ],
  })
}

async function handleChatCompletions(req, res) {
  const raw = (await readBody(req)).toString('utf8') || '{}'
  const body = JSON.parse(raw)
  const prompt = extractPrompt(body)
  if (process.env.ARCHE_E2E_FAKE_PROVIDER_DEBUG === '1') {
    console.log('[fake-provider] /v1/chat/completions prompt:', prompt.slice(0, 500))
  }
  const reply = buildReply(prompt)

  if (body.stream) {
    const id = generateId('chatcmpl')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created: now(),
      model: body.model || 'gpt-5.2',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: reply },
          finish_reason: null,
        },
      ],
    }

    res.write(`data: ${JSON.stringify(chunk)}\n\n`)

    const doneChunk = {
      id,
      object: 'chat.completion.chunk',
      created: now(),
      model: body.model || 'gpt-5.2',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }

    res.write(`data: ${JSON.stringify(doneChunk)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  sendJson(res, 200, {
    id: generateId('chatcmpl'),
    object: 'chat.completion',
    created: now(),
    model: body.model || 'gpt-5.2',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: reply },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`)

  if (req.method === 'GET' && url.pathname === '/__e2e/health') {
    sendJson(res, 200, { ok: true, version: 'e2e-fake-provider' })
    return
  }

  if (!requireAuth(req, res)) return

  try {
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      handleModels(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/responses') {
      await handleResponses(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleChatCompletions(req, res)
      return
    }

    sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } })
  } catch (error) {
    sendJson(res, 500, { error: { message: error instanceof Error ? error.message : 'internal_error', type: 'internal_error' } })
  }
})

server.listen(port, host, () => {
  console.log(`[fake-provider] listening on http://${host}:${port}`)
})
