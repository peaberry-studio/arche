import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { URL } from 'node:url'

const runtimeBaseUrl = process.env.ARCHE_E2E_RUNTIME_BASE_URL ?? `http://127.0.0.1:${process.env.ARCHE_E2E_RUNTIME_PORT ?? '4210'}`
const serverUrl = new URL(runtimeBaseUrl)
const port = Number.parseInt(serverUrl.port || '80', 10)
const host = serverUrl.hostname
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const basicAuthHeader = `Basic ${Buffer.from(`opencode:${runtimePassword}`).toString('base64')}`
const PDF_TOKEN = 'ARCHE_E2E_PDF_TOKEN'

const state = {
  nextMessageId: 1,
  nextPartId: 1,
  nextSessionId: 1,
  sessions: new Map(),
  files: new Map(),
  eventClients: new Set(),
}

function now() {
  return Date.now()
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function requireBasicAuth(request, response) {
  if (request.headers.authorization === basicAuthHeader) {
    return true
  }

  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="arche-e2e-runtime"' })
  response.end('Unauthorized')
  return false
}

function getOrCreateSession(sessionId) {
  const resolvedId = sessionId || `session-${state.nextSessionId++}`
  let session = state.sessions.get(resolvedId)

  if (!session) {
    session = {
      id: resolvedId,
      title: resolvedId,
      status: 'idle',
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    }
    state.sessions.set(resolvedId, session)
  }

  return session
}

function broadcastEvent(payload) {
  const chunk = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of state.eventClients) {
    client.write(chunk)
  }
}

function listFilesUnder(prefix) {
  const normalizedPrefix = typeof prefix === 'string' && prefix.length > 0 ? prefix.replace(/^\/+|\/+$/g, '') : ''
  const results = []

  for (const [filePath, entry] of state.files.entries()) {
    if (normalizedPrefix && !(filePath === normalizedPrefix || filePath.startsWith(`${normalizedPrefix}/`))) {
      continue
    }

    const relativeName = filePath.split('/').pop() ?? filePath
    results.push({
      path: filePath,
      name: relativeName,
      type: 'file',
      size: entry.content.length,
      modifiedAt: entry.modifiedAt,
    })
  }

  return results.sort((left, right) => left.path.localeCompare(right.path))
}

function reconstructPrompt(body) {
  const promptParts = []

  if (Array.isArray(body.parts)) {
    for (const part of body.parts) {
      if (!part || typeof part !== 'object') {
        continue
      }

      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        promptParts.push(part.text)
        continue
      }

      if (part.type === 'file') {
        const fileName = typeof part.filename === 'string' && part.filename.length > 0
          ? part.filename
          : typeof part.url === 'string' && part.url.length > 0
            ? part.url
            : 'attachment'
        promptParts.push(`[file:${fileName}]`)
      }
    }
  }

  if (typeof body.text === 'string' && body.text.length > 0) {
    promptParts.push(body.text)
  }

  return promptParts.join('\n').trim()
}

async function handlePrompt(request, response, pathname) {
  const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
  const sessionId = pathname.split('/')[2] ?? ''
  const session = getOrCreateSession(sessionId)
  const prompt = reconstructPrompt(body)
  const reply = prompt.includes(PDF_TOKEN) ? `PDF_OK: ${PDF_TOKEN}` : `E2E_OK: ${prompt}`
  const userMessageId = `message-${state.nextMessageId++}`
  const assistantMessageId = `message-${state.nextMessageId++}`
  const assistantPartId = `part-${state.nextPartId++}`

  session.status = 'busy'
  session.updatedAt = now()
  session.messages.push(
    { id: userMessageId, role: 'user', sessionId: session.id, text: prompt, createdAt: now() },
    { id: assistantMessageId, role: 'assistant', sessionId: session.id, text: reply, createdAt: now() },
  )

  broadcastEvent({
    type: 'session.status',
    properties: {
      sessionID: session.id,
      status: { type: 'busy' },
    },
  })
  broadcastEvent({
    type: 'message.updated',
    properties: {
      info: { id: userMessageId, role: 'user', sessionID: session.id },
    },
  })
  broadcastEvent({
    type: 'message.updated',
    properties: {
      info: {
        id: assistantMessageId,
        role: 'assistant',
        sessionID: session.id,
        providerID: 'e2e-provider',
        modelID: 'e2e-model',
        agent: 'assistant',
      },
    },
  })
  broadcastEvent({
    type: 'message.part.delta',
    properties: {
      messageID: assistantMessageId,
      partID: assistantPartId,
      partType: 'text',
      delta: reply,
      part: {
        id: assistantPartId,
        type: 'text',
        messageID: assistantMessageId,
        sessionID: session.id,
      },
    },
  })

  session.status = 'idle'
  session.updatedAt = now()
  broadcastEvent({
    type: 'session.idle',
    properties: { sessionID: session.id },
  })

  sendJson(response, 200, { ok: true, sessionID: session.id, messageID: assistantMessageId })
}

async function handleFilesList(request, response) {
  const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
  const files = listFilesUnder(typeof body.path === 'string' ? body.path : '')
  sendJson(response, 200, { ok: true, entries: files })
}

async function handleFilesRead(request, response) {
  const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
  const filePath = typeof body.path === 'string' ? body.path.replace(/^\/+/, '') : ''
  const file = state.files.get(filePath)

  if (!file) {
    sendJson(response, 404, { ok: false, error: 'not_found' })
    return
  }

  const isText = file.mime.startsWith('text/') || file.mime === 'application/json'
  sendJson(response, 200, {
    ok: true,
    content: isText ? file.content.toString('utf8') : file.content.toString('base64'),
    encoding: isText ? 'utf-8' : 'base64',
  })
}

async function handleFilesRename(request, response) {
  const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
  const fromPath = typeof body.path === 'string' ? body.path.replace(/^\/+/, '') : ''
  const newPath = typeof body.newPath === 'string' ? body.newPath.replace(/^\/+/, '') : ''
  const file = state.files.get(fromPath)

  if (!file) {
    sendJson(response, 404, { ok: false, error: 'not_found' })
    return
  }

  if (state.files.has(newPath)) {
    sendJson(response, 409, { ok: false, error: 'path_conflict' })
    return
  }

  state.files.delete(fromPath)
  state.files.set(newPath, { ...file, modifiedAt: now() })
  sendJson(response, 200, { ok: true, path: fromPath, newPath })
}

async function handleFilesUpload(request, response, url) {
  const filePath = (url.searchParams.get('path') ?? '').replace(/^\/+/, '')
  const content = await readBody(request)
  const mime = request.headers['content-type'] ?? 'application/octet-stream'

  state.files.set(filePath, {
    path: filePath,
    mime,
    content,
    modifiedAt: now(),
    hash: createHash('sha256').update(content).digest('hex'),
  })

  sendJson(response, 200, {
    ok: true,
    path: filePath,
    hash: state.files.get(filePath).hash,
    size: content.length,
    modifiedAt: state.files.get(filePath).modifiedAt,
  })
}

function handleInternalSessions(response) {
  sendJson(response, 200, {
    ok: true,
    sessions: Array.from(state.sessions.values()).map((session) => ({
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    })),
  })
}

const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const pathname = url.pathname

  try {
    if (method === 'GET' && pathname === '/__e2e/health') {
      sendJson(response, 200, { ok: true, version: 'e2e-fake-runtime' })
      return
    }

    if (method === 'GET' && pathname === '/__e2e/sessions') {
      handleInternalSessions(response)
      return
    }

    if (method === 'POST' && pathname === '/__e2e/sessions') {
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      const session = getOrCreateSession(typeof body.id === 'string' ? body.id : '')
      if (typeof body.title === 'string' && body.title.trim()) {
        session.title = body.title.trim()
      }
      sendJson(response, 201, { ok: true, session })
      return
    }

    if (method === 'PATCH' && /^\/__e2e\/sessions\/[^/]+$/.test(pathname)) {
      const session = getOrCreateSession(pathname.split('/').pop())
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      if (typeof body.title === 'string') {
        session.title = body.title
      }
      if (typeof body.status === 'string') {
        session.status = body.status
      }
      session.updatedAt = now()
      sendJson(response, 200, { ok: true, session })
      return
    }

    if (method === 'DELETE' && /^\/__e2e\/sessions\/[^/]+$/.test(pathname)) {
      state.sessions.delete(pathname.split('/').pop())
      sendJson(response, 200, { ok: true })
      return
    }

    if (method === 'GET' && /^\/__e2e\/sessions\/[^/]+\/messages$/.test(pathname)) {
      const sessionId = pathname.split('/')[3]
      const session = state.sessions.get(sessionId)
      sendJson(response, 200, { ok: true, messages: session?.messages ?? [] })
      return
    }

    if (method === 'GET' && pathname === '/__e2e/sessions/status') {
      sendJson(response, 200, {
        ok: true,
        sessions: Array.from(state.sessions.values()).map((session) => ({ id: session.id, status: session.status })),
      })
      return
    }

    if (method === 'GET' && pathname === '/__e2e/providers') {
      sendJson(response, 200, { ok: true, providers: [{ id: 'e2e-provider', name: 'E2E Provider' }] })
      return
    }

    if (method === 'GET' && pathname === '/__e2e/agents') {
      sendJson(response, 200, { ok: true, agents: [{ id: 'assistant', name: 'Assistant' }] })
      return
    }

    if (method === 'GET' && pathname === '/__e2e/files') {
      sendJson(response, 200, {
        ok: true,
        files: Array.from(state.files.values()).map((file) => ({
          path: file.path,
          mime: file.mime,
          size: file.content.length,
          modifiedAt: file.modifiedAt,
          hash: file.hash,
        })),
      })
      return
    }

    if (!requireBasicAuth(request, response)) {
      return
    }

    if (method === 'GET' && pathname === '/global/health') {
      sendJson(response, 200, { ok: true, healthy: true, version: 'e2e-fake-runtime' })
      return
    }

    if (method === 'GET' && pathname === '/event') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      state.eventClients.add(response)
      request.on('close', () => {
        state.eventClients.delete(response)
      })
      return
    }

    if (method === 'POST' && /^\/session\/[^/]+\/prompt_async$/.test(pathname)) {
      await handlePrompt(request, response, pathname)
      return
    }

    if (method === 'POST' && pathname === '/files/list') {
      await handleFilesList(request, response)
      return
    }

    if (method === 'POST' && pathname === '/files/read') {
      await handleFilesRead(request, response)
      return
    }

    if (method === 'POST' && pathname === '/files/rename') {
      await handleFilesRename(request, response)
      return
    }

    if (method === 'POST' && pathname === '/files/upload') {
      await handleFilesUpload(request, response, url)
      return
    }

    if (method === 'GET' && pathname === '/git/diffs') {
      sendJson(response, 200, { ok: true, files: [] })
      return
    }

    sendJson(response, 404, { ok: false, error: 'not_found' })
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : 'internal_error' })
  }
})

server.listen(port, host)
