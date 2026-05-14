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
const DEFAULT_AGENT = 'assistant'
const DEFAULT_DIRECTORY = '/workspace'
const DEFAULT_MODEL_ID = 'e2e-model'
const DEFAULT_PROJECT_ID = 'project-e2e'
const DEFAULT_PROVIDER_ID = 'e2e-provider'
const DEFAULT_PROVIDER_NAME = 'E2E Provider'
const DEFAULT_SESSION_VERSION = 'e2e-fake-runtime'

const state = {
  nextMessageId: 1,
  nextPartId: 1,
  nextSessionId: 1,
  sessions: new Map(),
  files: new Map(),
  providerAuth: new Map(),
  eventClients: new Set(),
  nextEventClientGeneration: 1,
  pendingEventBatches: [],
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
      parentID: undefined,
      status: 'idle',
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    }
    state.sessions.set(resolvedId, session)
  }

  return session
}

function buildProviderModel() {
  return {
    id: DEFAULT_MODEL_ID,
    providerID: DEFAULT_PROVIDER_ID,
    api: {
      id: DEFAULT_PROVIDER_ID,
      url: 'https://example.invalid/e2e-provider',
      npm: '@arche/e2e-provider',
    },
    name: 'E2E Model',
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: true,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 128000,
      output: 4096,
    },
    status: 'active',
    options: {},
    headers: {},
    release_date: '2026-01-01',
  }
}

function buildProviderDescriptor() {
  return {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    source: 'custom',
    env: [],
    options: {},
    models: {
      [DEFAULT_MODEL_ID]: buildProviderModel(),
    },
  }
}

function buildAgentDescriptor() {
  return {
    name: DEFAULT_AGENT,
    description: 'Assistant',
    mode: 'primary',
    permission: [],
    options: {},
  }
}

function mapSessionToSdk(session) {
  return {
    id: session.id,
    slug: session.id,
    projectID: DEFAULT_PROJECT_ID,
    directory: DEFAULT_DIRECTORY,
    ...(session.parentID ? { parentID: session.parentID } : {}),
    title: session.title,
    version: DEFAULT_SESSION_VERSION,
    time: {
      created: session.createdAt,
      updated: session.updatedAt,
    },
  }
}

function mapMessageInfo(message) {
  if (message.role === 'assistant') {
    return {
      id: message.id,
      sessionID: message.sessionId,
      role: 'assistant',
      time: {
        created: message.createdAt,
        completed: message.createdAt,
      },
      parentID: message.parentID ?? '',
      modelID: DEFAULT_MODEL_ID,
      providerID: DEFAULT_PROVIDER_ID,
      mode: 'primary',
      agent: DEFAULT_AGENT,
      path: {
        cwd: DEFAULT_DIRECTORY,
        root: DEFAULT_DIRECTORY,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    }
  }

  return {
    id: message.id,
    sessionID: message.sessionId,
    role: 'user',
    time: {
      created: message.createdAt,
    },
    agent: DEFAULT_AGENT,
    model: {
      providerID: DEFAULT_PROVIDER_ID,
      modelID: DEFAULT_MODEL_ID,
    },
  }
}

function mapMessageToSdk(message) {
  const parts = message.parts ?? [
    {
      id: `part-${message.id}`,
      sessionID: message.sessionId,
      messageID: message.id,
      type: 'text',
      text: message.text ?? '',
    },
  ]

  return {
    info: mapMessageInfo(message),
    parts,
  }
}

function extractE2eReadFilePath(prompt) {
  const match = prompt.match(/E2E_READ_FILE:([^\s]+)/)
  return match?.[1]?.replace(/^\/+/, '')
}

function listSdkFilesAtPath(pathValue) {
  const normalizedPath = typeof pathValue === 'string' ? pathValue.replace(/^\/+|\/+$/g, '') : ''
  const entries = new Map()

  for (const [filePath, file] of state.files.entries()) {
    const normalizedFilePath = filePath.replace(/^\/+|\/+$/g, '')
    if (!normalizedFilePath) {
      continue
    }

    const parts = normalizedFilePath.split('/')
    const parentParts = normalizedPath ? normalizedPath.split('/') : []

    if (parentParts.length > parts.length || !parentParts.every((part, index) => parts[index] === part)) {
      continue
    }

    const remainder = parts.slice(parentParts.length)
    if (remainder.length === 0) {
      continue
    }

    if (remainder.length === 1) {
      entries.set(normalizedFilePath, {
        name: remainder[0],
        path: normalizedFilePath,
        absolute: `${DEFAULT_DIRECTORY}/${normalizedFilePath}`,
        type: 'file',
        ignored: false,
        mime: file.mime,
      })
      continue
    }

    const directoryPath = [...parentParts, remainder[0]].join('/')
    if (!entries.has(directoryPath)) {
      entries.set(directoryPath, {
        name: remainder[0],
        path: directoryPath,
        absolute: `${DEFAULT_DIRECTORY}/${directoryPath}`,
        type: 'directory',
        ignored: false,
      })
    }
  }

  return Array.from(entries.values()).sort((left, right) => left.path.localeCompare(right.path))
}

function listSessionsForSdk(url) {
  const rootsOnly = url.searchParams.get('roots') === 'true'
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()
  const startRaw = url.searchParams.get('start')
  const limitRaw = url.searchParams.get('limit')
  const start = startRaw ? Number.parseInt(startRaw, 10) : Number.NaN
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN

  let sessions = Array.from(state.sessions.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)

  if (rootsOnly) {
    sessions = sessions.filter((session) => !session.parentID)
  }

  if (search) {
    sessions = sessions.filter((session) => session.title.toLowerCase().includes(search))
  }

  if (Number.isFinite(start)) {
    sessions = sessions.filter((session) => session.updatedAt < start)
  }

  if (Number.isFinite(limit) && limit > 0) {
    sessions = sessions.slice(0, limit)
  }

  return sessions.map((session) => mapSessionToSdk(session))
}

function createPromptResponse(session, prompt) {
  const readFilePath = extractE2eReadFilePath(prompt)
  const reply = prompt.includes(PDF_TOKEN)
    ? `PDF_OK: ${PDF_TOKEN}`
    : readFilePath
      ? `E2E_FILE_READY: ${readFilePath}`
      : `E2E_OK: ${prompt}`
  const userMessageId = `message-${state.nextMessageId++}`
  const assistantMessageId = `message-${state.nextMessageId++}`
  const assistantPartId = `part-${state.nextPartId++}`

  session.status = 'busy'
  session.updatedAt = now()

  const userMessage = {
    id: userMessageId,
    role: 'user',
    sessionId: session.id,
    text: prompt,
    createdAt: now(),
  }
  const assistantMessage = {
    id: assistantMessageId,
    role: 'assistant',
    sessionId: session.id,
    parentID: userMessageId,
    text: reply,
    parts: readFilePath
      ? [
          {
            id: `tool-${assistantMessageId}`,
            sessionID: session.id,
            messageID: assistantMessageId,
            type: 'tool',
            tool: 'read',
            callID: `call-${assistantMessageId}`,
            state: {
              status: 'completed',
              input: { filePath: `${DEFAULT_DIRECTORY}/${readFilePath}` },
              output: state.files.get(readFilePath)?.content.toString('utf8') ?? '',
              title: `Read ${readFilePath}`,
            },
          },
          {
            id: `part-${assistantMessageId}`,
            sessionID: session.id,
            messageID: assistantMessageId,
            type: 'text',
            text: reply,
          },
        ]
      : undefined,
    createdAt: now(),
  }

  session.messages.push(userMessage, assistantMessage)

  return {
    reply,
    userMessage,
    assistantMessage,
    assistantPartId,
  }
}

function addEventClient(response) {
  const client = {
    generation: state.nextEventClientGeneration++,
    response,
  }
  state.eventClients.add(client)
  setTimeout(flushPendingEventBatches, 25)
  return client
}

function broadcastEvent(payload, clients = state.eventClients) {
  const chunk = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) {
    client.response.write(chunk)
  }
}

function flushPendingEventBatches() {
  if (state.eventClients.size === 0 || state.pendingEventBatches.length === 0) {
    return
  }

  const remainingBatches = []
  const batches = state.pendingEventBatches.splice(0)
  for (const batch of batches) {
    const eligibleClients = Array.from(state.eventClients)
      .filter((client) => client.generation >= batch.minEventClientGeneration)

    if (eligibleClients.length === 0) {
      remainingBatches.push(batch)
      continue
    }

    for (const event of batch.events) {
      broadcastEvent(event, eligibleClients)
    }

    batch.session.status = 'idle'
    batch.session.updatedAt = now()
    broadcastEvent({
      type: 'session.idle',
      properties: { sessionID: batch.session.id },
    }, eligibleClients)
  }

  state.pendingEventBatches.push(...remainingBatches)
}

function queuePromptEvents(session, userMessage, assistantMessage, assistantPartId, reply) {
  const minEventClientGeneration = state.eventClients.size === 0
    ? state.nextEventClientGeneration
    : state.nextEventClientGeneration - 1

  state.pendingEventBatches.push({
    minEventClientGeneration,
    session,
    events: [
      {
        type: 'session.status',
        properties: {
          sessionID: session.id,
          status: { type: 'busy' },
        },
      },
      {
        type: 'message.updated',
        properties: {
          info: mapMessageInfo(userMessage),
        },
      },
      {
        type: 'message.updated',
        properties: {
          info: mapMessageInfo(assistantMessage),
        },
      },
      {
        type: 'message.part.delta',
        properties: {
          messageID: assistantMessage.id,
          partID: assistantPartId,
          partType: 'text',
          delta: reply,
          part: {
            id: assistantPartId,
            type: 'text',
            messageID: assistantMessage.id,
            sessionID: session.id,
          },
        },
      },
    ],
  })

  setTimeout(flushPendingEventBatches, 25)
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
  const { reply, userMessage, assistantMessage, assistantPartId } = createPromptResponse(session, prompt)

  response.writeHead(204)
  response.end()
  queuePromptEvents(session, userMessage, assistantMessage, assistantPartId, reply)
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

async function handleFilesWrite(request, response) {
  const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
  const filePath = typeof body.path === 'string' ? body.path.replace(/^\/+/, '') : ''
  const rawContent = typeof body.content === 'string' ? body.content : ''
  const content = body.encoding === 'base64'
    ? Buffer.from(rawContent, 'base64')
    : Buffer.from(rawContent, 'utf8')
  const existing = state.files.get(filePath)

  state.files.set(filePath, {
    path: filePath,
    mime: existing?.mime ?? (filePath.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain'),
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

async function handleProviderAuth(request, response, pathname) {
  const providerId = pathname.split('/')[2] ?? ''

  if (request.method === 'PUT') {
    const rawBody = (await readBody(request)).toString('utf8')
    const auth = rawBody.trim() ? JSON.parse(rawBody) : {}
    state.providerAuth.set(providerId, { auth, updatedAt: now() })
    sendJson(response, 200, true)
    return
  }

  state.providerAuth.delete(providerId)
  sendJson(response, 200, true)
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

    if (!requireBasicAuth(request, response)) {
      return
    }

    if ((method === 'PUT' || method === 'DELETE') && /^\/auth\/[^/]+$/.test(pathname)) {
      await handleProviderAuth(request, response, pathname)
      return
    }

    if (method === 'POST' && pathname === '/instance/dispose') {
      sendJson(response, 200, true)
      return
    }

    if (method === 'GET' && pathname === '/session') {
      sendJson(response, 200, listSessionsForSdk(url))
      return
    }

    if (method === 'POST' && pathname === '/session') {
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      const session = getOrCreateSession('')
      session.parentID = typeof body.parentID === 'string' && body.parentID.length > 0 ? body.parentID : undefined
      if (typeof body.title === 'string' && body.title.trim()) {
        session.title = body.title.trim()
      }
      session.updatedAt = now()
      sendJson(response, 200, mapSessionToSdk(session))
      return
    }

    if (method === 'GET' && pathname === '/session/status') {
      sendJson(
        response,
        200,
        Object.fromEntries(
          Array.from(state.sessions.values()).map((session) => [session.id, session.status === 'busy' ? { type: 'busy' } : { type: 'idle' }]),
        ),
      )
      return
    }

    if (method === 'GET' && /^\/session\/[^/]+$/.test(pathname)) {
      const session = state.sessions.get(pathname.split('/')[2] ?? '')
      if (!session) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      sendJson(response, 200, mapSessionToSdk(session))
      return
    }

    if (method === 'PATCH' && /^\/session\/[^/]+$/.test(pathname)) {
      const session = state.sessions.get(pathname.split('/')[2] ?? '')
      if (!session) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      if (typeof body.title === 'string') {
        session.title = body.title
      }
      session.updatedAt = now()
      sendJson(response, 200, mapSessionToSdk(session))
      return
    }

    if (method === 'DELETE' && /^\/session\/[^/]+$/.test(pathname)) {
      state.sessions.delete(pathname.split('/')[2] ?? '')
      sendJson(response, 200, true)
      return
    }

    if (method === 'GET' && /^\/session\/[^/]+\/children$/.test(pathname)) {
      const sessionId = pathname.split('/')[2] ?? ''
      if (!state.sessions.has(sessionId)) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      sendJson(
        response,
        200,
        Array.from(state.sessions.values())
          .filter((session) => session.parentID === sessionId)
          .map((session) => mapSessionToSdk(session)),
      )
      return
    }

    if (method === 'GET' && /^\/session\/[^/]+\/message$/.test(pathname)) {
      const sessionId = pathname.split('/')[2] ?? ''
      const session = state.sessions.get(sessionId)
      if (!session) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      sendJson(response, 200, session.messages.map((message) => mapMessageToSdk(message)))
      return
    }

    if (method === 'POST' && /^\/session\/[^/]+\/message$/.test(pathname)) {
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      const sessionId = pathname.split('/')[2] ?? ''
      const session = getOrCreateSession(sessionId)
      const prompt = reconstructPrompt(body)
      const { assistantMessage } = createPromptResponse(session, prompt)
      session.status = 'idle'
      session.updatedAt = now()
      sendJson(response, 200, mapMessageToSdk(assistantMessage))
      return
    }

    if (method === 'POST' && /^\/session\/[^/]+\/abort$/.test(pathname)) {
      const session = state.sessions.get(pathname.split('/')[2] ?? '')
      if (!session) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      session.status = 'idle'
      session.updatedAt = now()
      sendJson(response, 200, true)
      return
    }

    if (method === 'GET' && /^\/session\/[^/]+\/diff$/.test(pathname)) {
      if (!state.sessions.has(pathname.split('/')[2] ?? '')) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'Session not found' } })
        return
      }

      sendJson(response, 200, [])
      return
    }

    if (method === 'GET' && pathname === '/config/providers') {
      sendJson(response, 200, {
        providers: [buildProviderDescriptor()],
        default: { [DEFAULT_PROVIDER_ID]: DEFAULT_MODEL_ID },
      })
      return
    }

    if (method === 'GET' && pathname === '/agent') {
      sendJson(response, 200, [buildAgentDescriptor()])
      return
    }

    if (method === 'GET' && pathname === '/file') {
      sendJson(response, 200, listSdkFilesAtPath(url.searchParams.get('path') ?? ''))
      return
    }

    if (method === 'GET' && pathname === '/file/content') {
      const filePath = (url.searchParams.get('path') ?? '').replace(/^\/+/, '')
      const file = state.files.get(filePath)
      if (!file) {
        sendJson(response, 404, { name: 'NotFoundError', data: { message: 'File not found' } })
        return
      }

      const isText = file.mime.startsWith('text/') || file.mime === 'application/json'
      sendJson(response, 200, {
        type: 'text',
        content: isText ? file.content.toString('utf8') : file.content.toString('base64'),
        ...(isText ? {} : { encoding: 'base64' }),
        mimeType: file.mime,
      })
      return
    }

    if (method === 'GET' && pathname === '/find/file') {
      const query = (url.searchParams.get('query') ?? '').trim().toLowerCase()
      const matches = Array.from(state.files.keys())
        .filter((filePath) => !query || filePath.toLowerCase().includes(query))
        .sort((left, right) => left.localeCompare(right))
      sendJson(response, 200, matches)
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

    if (method === 'GET' && pathname === '/global/health') {
      sendJson(response, 200, { ok: true, healthy: true, version: 'e2e-fake-runtime' })
      return
    }

    if (method === 'GET' && pathname === '/global/event') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      const client = addEventClient(response)
      request.on('close', () => {
        state.eventClients.delete(client)
      })
      return
    }

    if (method === 'GET' && pathname === '/event') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      const client = addEventClient(response)
      request.on('close', () => {
        state.eventClients.delete(client)
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

    if (method === 'POST' && pathname === '/files/write') {
      await handleFilesWrite(request, response)
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
