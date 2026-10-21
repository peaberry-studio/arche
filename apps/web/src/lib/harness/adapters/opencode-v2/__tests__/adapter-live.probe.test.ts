import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import {
  abortSessionFamilyAndConfirmIdle,
  captureSessionMessageCursor,
  createSessionPromptRun,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/harness/execution'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'

// Opt-in live probe: `OPENCODE_V2_LIVE_PROBE=1 pnpm exec vitest run <this file>`
// from apps/web. It drives the real V2 adapter and shared execution against a
// foreground loopback `opencode serve` (2.0.32) with repository-local scratch,
// a synthetic gateway and a fake provider. No host service or real key is used.
const LIVE = process.env.OPENCODE_V2_LIVE_PROBE === '1'
const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A9l8L+F9CuNEu/F3i+8mtdJtZ0tY4rRFe5ubh1L7E3kKioo3MzZ6gAEmjxR4X0K30S08XeELya60m6ne1kiu0VLm2uEUPsfYSrq6ncrrjoQQCOX+B/FWiaKJtL8V6PFq+lXDeYVaPMscgGNyMrxPgjgqJFHejxx4r0TWhDpfhTR4tI0q3bzAqx4llkIxudmaV+BwFMjDvX8xWw/1a+l7efNe+/a1v6uf6G3xv1+3vct7393k5bbfzc19f15dD/9k='

const mocks = vi.hoisted(() => ({ connection: { baseUrl: '', authHeader: '' }, createRun: vi.fn(), usage: vi.fn(), setSync: vi.fn(), activeRun: { value: false } }))
vi.mock('@/lib/harness/runtime-connection', () => ({
  getInstanceBasicAuth: async () => mocks.connection,
  getInstanceUrl: () => mocks.connection.baseUrl,
}))
vi.mock('@/lib/harness/registry', () => ({ syncRuntimeProviderAccess: vi.fn() }))
vi.mock('@/lib/runtime/workspace-host', () => ({ getWorkspaceStatus: vi.fn(), startWorkspace: vi.fn() }))
vi.mock('@/lib/providers/store', () => ({ getEnabledProviderCredentialsForUser: vi.fn() }))
vi.mock('@/lib/providers/config', () => ({ getGatewayTokenTtlSeconds: () => 3600 }))
vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: (input: { providerId: string; version: number }) => `live-token-${input.providerId}-${input.version}-${randomBytes(6).toString('hex')}`,
}))
vi.mock('@/lib/providers/run-usage', () => ({ recordProviderRunUsageBestEffort: mocks.usage }))
vi.mock('@/lib/services', () => ({
  instanceService: {
    touchActivity: async () => undefined,
    findProviderSyncBySlug: async () => ({ providerSyncHash: null, providerSyncedAt: null, status: 'running' }),
    setProviderSyncState: mocks.setSync,
  },
  messageRunService: {
    createActiveRunAfterRuntimeStateCheck: mocks.createRun,
    hasActiveRunForSlug: async () => mocks.activeRun.value,
  },
}))

type GatewayRequest = { path: string; credential: string; text: string }

describe.skipIf(!LIVE)('V2 adapter against a live isolated 2.0.32 server', () => {
  let root = ''
  let workspace = ''
  let child: ChildProcess | undefined
  let stub: Server
  let client: ReturnType<typeof OpenCode.make>
  const requests: GatewayRequest[] = []
  const release = new AbortController()
  const runtime = createOpenCodeV2Runtime('live')
  const create = (title: string, parentID?: string) => client.session.create({ title, parentID, agent: 'probe', model: { providerID: 'openrouter', id: 'fixture' }, location: { directory: workspace } })
  const isActive = async (id: string) => Boolean((await client.session.active())[id])
  const waitFor = async (predicate: () => Promise<boolean>, label: string, budget = 20_000) => {
    const deadline = Date.now() + budget
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
      await delay(50)
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(process.cwd(), '.v2-adapter-live-'))
    workspace = join(root, 'workspace')
    await Promise.all(['workspace', 'home', 'config/opencode', 'data', 'cache', 'state', 'tmp'].map((directory) => mkdir(join(root, directory), { recursive: true })))
    stub = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = body ? JSON.parse(body) : {}
      const text = JSON.stringify(input.messages ?? [])
      const credential = String(request.headers.authorization ?? request.headers['x-api-key'] ?? '').replace(/^Bearer /, '')
      requests.push({ path: request.url ?? '', credential: credential.startsWith('live-token-') ? credential.split('-').slice(0, 4).join('-') : credential ? 'other' : 'none', text })
      if (request.url?.startsWith('/gateway/') && !credential.startsWith('live-token-')) {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'gateway credential required', type: 'authentication_error' } }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (text.includes('SLOW_PROBE')) {
        response.write(': waiting\n\n')
        await delay(60_000, undefined, { signal: release.signal }).catch(() => undefined)
      }
      response.end(`data: ${JSON.stringify({ id: 'live', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Live fixture reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
    const address = stub.address()
    const endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
    const model = { capabilities: { tools: true, input: ['text', 'image'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
    await writeFile(join(root, 'config/opencode/opencode.json'), JSON.stringify({
      update: 'disable', snapshots: false, model: 'openrouter/fixture', default_agent: 'probe',
      providers: {
        openrouter: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${endpoint}/v1`, apiKey: randomBytes(8).toString('hex') }, models: { fixture: model } },
        anthropic: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${endpoint}/gateway/anthropic` }, models: { fixture: model } },
        custom: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${endpoint}/custom` }, models: { fixture: model } },
      },
      agents: { probe: { mode: 'primary', system: 'Answer briefly.', permissions: [{ action: '*', resource: '*', effect: 'deny' }] } },
    }))
    const password = randomBytes(24).toString('hex')
    const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: workspace,
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = server
    let log = ''
    server.stdout?.on('data', (chunk) => { log += chunk })
    server.stderr?.on('data', (chunk) => { log += chunk })
    await waitFor(async () => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
    mocks.connection.baseUrl = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? ''
    mocks.connection.authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    client = OpenCode.make({ baseUrl: mocks.connection.baseUrl, headers: { Authorization: mocks.connection.authHeader } })
    await waitFor(async () => { try { return (await client.server.info()).version === '2.0.32' } catch { return false } }, 'readiness')
    mocks.createRun.mockImplementation(async (input: { readRuntimeSessionState: () => Promise<string> }) => (
      await input.readRuntimeSessionState() === 'idle' ? { ok: true, run: { id: 'live-run' } } : { ok: false, error: 'session_busy', activeRun: null }
    ))
  }, 60_000)

  afterAll(async () => {
    release.abort()
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve))
      child.kill('SIGTERM')
      await Promise.race([exited, delay(5_000).then(() => child?.kill('SIGKILL'))])
    }
    stub?.closeAllConnections()
    if (stub?.listening) await new Promise((resolve) => stub.close(resolve))
    if (root) await rm(root, { recursive: true, force: true })
  }, 30_000)

  const generate = async (providerID: string) => {
    const session = await client.session.create({ title: `gen-${providerID}`, agent: 'probe', model: { providerID, id: 'fixture' }, location: { directory: workspace } })
    const before = requests.length
    await client.session.prompt({ sessionID: session.id, text: 'hello' })
    await waitFor(async () => !await isActive(session.id) && (await client.message.list({ sessionID: session.id })).data.some((message) => message.type === 'assistant'), `generation ${providerID}`)
    const assistant = (await client.message.list({ sessionID: session.id })).data.find((message) => message.type === 'assistant')
    return { ok: assistant?.type === 'assistant' && !assistant.error, credentials: requests.slice(before).map((request) => request.credential) }
  }

  it('syncs, refreshes and revokes gateway credentials while preserving unrelated entries', async () => {
    await client.credential.create({ integrationID: 'custom', label: 'user added', value: { type: 'key', key: randomBytes(8).toString('hex') }, activate: true })
    await client.credential.create({ integrationID: 'anthropic', label: 'user added', value: { type: 'key', key: randomBytes(8).toString('hex') }, activate: true })
    const enabled = (entries: Array<['anthropic', number]>): EnabledProviderCredentials => new Map(entries.map(([id, version]) => [id, { credentialId: `${id}-cred`, source: 'user', version }]))

    vi.mocked(getEnabledProviderCredentialsForUser).mockResolvedValue(enabled([['anthropic', 1]]))
    expect(await runtime.syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: true, data: undefined })
    const synced = await client.credential.list()
    expect(synced.map(({ integrationID, label, active }) => ({ integrationID, label, active })).sort((a, b) => a.integrationID.localeCompare(b.integrationID))).toEqual([
      { integrationID: 'anthropic', label: 'arche-managed:anthropic', active: true },
      { integrationID: 'custom', label: 'user added', active: true },
      { integrationID: 'opencode', label: 'arche-managed:opencode', active: true },
    ])
    expect(await generate('anthropic')).toEqual({ ok: true, credentials: ['live-token-anthropic-1'] })
    expect(mocks.setSync).toHaveBeenCalledTimes(1)

    vi.mocked(getEnabledProviderCredentialsForUser).mockResolvedValue(enabled([['anthropic', 2]]))
    expect(await runtime.syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: true, data: undefined })
    expect(await generate('anthropic')).toEqual({ ok: true, credentials: ['live-token-anthropic-2'] })

    vi.mocked(getEnabledProviderCredentialsForUser).mockResolvedValue(enabled([]))
    expect(await runtime.syncProviderAccess({ userId: 'user-1', force: true })).toEqual({ ok: true, data: undefined })
    expect((await client.credential.list()).map(({ integrationID }) => integrationID).sort()).toEqual(['custom', 'opencode'])
    const revoked = await generate('anthropic')
    expect(revoked.ok).toBe(false)
    expect(revoked.credentials.every((credential) => credential === 'none')).toBe(true)
    expect(mocks.setSync).toHaveBeenCalledTimes(3)
  }, 90_000)

  it('admits, refuses while busy, settles and books a completed run', async () => {
    const session = await create('run')
    expect(await createSessionPromptRun({ client: runtime, sessionId: session.id, slug: 'live', source: 'flow' })).toEqual({ ok: true, run: { id: 'live-run' } })
    const cursor = await captureSessionMessageCursor(runtime, session.id)
    expect(await runtime.prompt({ sessionId: session.id, messageId: 'msg_live_run', parts: [{ type: 'text', text: 'Settle this run' }] })).toEqual({ ok: true, data: undefined })
    expect(await waitForSessionToComplete({ client: runtime, cursor, sessionId: session.id, slug: 'live', usage: { messageRunId: 'live-run', userId: 'user-1', source: 'flow' } })).toEqual({ status: 'completed' })
    expect(await readLatestAssistantText(runtime, session.id, cursor)).toBe('Live fixture reply')
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ messageRunId: 'live-run', providerId: 'openrouter', inputTokens: 11, outputTokens: 3 }), '[harness/execution]')
    const first = await client.message.list({ sessionID: session.id, order: 'asc', limit: 1 })
    const rest = await client.message.list({ sessionID: session.id, limit: 100, cursor: first.cursor.next ?? undefined })
    const history = await runtime.listMessages(session.id)
    expect(history.ok && history.data.map((message) => message.id)).toEqual([...first.data, ...rest.data].flatMap((message) => message.type === 'user' || message.type === 'assistant' ? [message.id] : []))
    await expect(client.message.list({ sessionID: session.id, order: 'asc', limit: 1, cursor: first.cursor.next ?? undefined })).rejects.toMatchObject({ message: 'Cursor cannot be combined with order' })

    const parent = await create('busy-parent')
    const busyChild = await create('busy-child', parent.id)
    await client.session.prompt({ sessionID: busyChild.id, text: 'SLOW_PROBE busy child' })
    await waitFor(() => isActive(busyChild.id), 'busy child')
    mocks.createRun.mockClear()
    expect(await createSessionPromptRun({ client: runtime, sessionId: parent.id, slug: 'live', source: 'flow' })).toEqual({ ok: false, error: 'session_busy', activeRun: null })
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(await abortSessionFamilyAndConfirmIdle({ client: runtime, rootSessionId: parent.id })).toBe(true)
  }, 90_000)

  it('stops a parent with two busy children and confirms the family idle', async () => {
    const parent = await create('family')
    const children = [await create('family-a', parent.id), await create('family-b', parent.id)]
    for (const session of [parent, ...children]) await client.session.prompt({ sessionID: session.id, text: 'SLOW_PROBE family' })
    await waitFor(async () => (await Promise.all([parent, ...children].map((session) => isActive(session.id)))).every(Boolean), 'family busy')
    expect(await abortSessionFamilyAndConfirmIdle({ client: runtime, rootSessionId: parent.id })).toBe(true)
    expect(await Promise.all([parent, ...children].map((session) => isActive(session.id)))).toEqual([false, false, false])
  }, 60_000)

  it('reports unconfirmed termination while a child keeps getting restarted', async () => {
    const parent = await create('stubborn')
    const stubborn = await create('stubborn-child', parent.id)
    await client.session.prompt({ sessionID: stubborn.id, text: 'SLOW_PROBE stubborn' })
    await waitFor(() => isActive(stubborn.id), 'stubborn busy')
    const keepRestarting = new AbortController()
    const restarter = (async () => {
      while (!keepRestarting.signal.aborted) {
        await client.session.prompt({ sessionID: stubborn.id, text: 'SLOW_PROBE restarted' }).catch(() => undefined)
        await delay(5)
      }
    })()
    try {
      expect(await abortSessionFamilyAndConfirmIdle({ client: runtime, rootSessionId: parent.id })).toBe(false)
    } finally {
      keepRestarting.abort()
      await restarter
    }
    expect(await abortSessionFamilyAndConfirmIdle({ client: runtime, rootSessionId: parent.id })).toBe(true)
  }, 60_000)

  it('returns synchronous replies and keeps no-reply input undelivered until the next prompt', async () => {
    const session = await create('sync')
    const before = requests.length
    expect(await runtime.sendMessage({ sessionId: session.id, messageId: 'msg_live_note', noReply: true, parts: [{ type: 'text', text: 'NO_REPLY_CONTEXT' }] })).toMatchObject({ ok: true, data: { id: 'msg_live_note', role: 'user' } })
    await delay(500)
    expect(requests.length).toBe(before)
    expect(await isActive(session.id)).toBe(false)
    expect(await runtime.sessionStatus()).toMatchObject({ ok: true })
    const reply = await runtime.sendMessage({ sessionId: session.id, parts: [{ type: 'text', text: 'Follow up' }] })
    expect(reply).toMatchObject({ ok: true, data: { role: 'assistant', content: 'Live fixture reply' } })
    expect(requests.slice(before).some((request) => request.text.includes('NO_REPLY_CONTEXT'))).toBe(true)
    const history = await runtime.listMessages(session.id)
    expect(history.ok && history.data.map((message) => message.role)).toEqual(['user', 'user', 'assistant'])
  }, 60_000)

  it('delivers inline JPEG, PNG, GIF and WebP attachments through the adapter', async () => {
    const images = {
      'image/jpeg': JPEG_BASE64,
      'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'image/gif': 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
      'image/webp': 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
    }
    for (const [mime, data] of Object.entries(images)) {
      const session = await create(`inline-${mime}`)
      const before = requests.length
      expect(await runtime.prompt({ sessionId: session.id, parts: [{ type: 'text', text: 'Describe' }, { type: 'file', mime, filename: 'inline', url: `data:${mime};base64,${data}` }] })).toEqual({ ok: true, data: undefined })
      await waitFor(async () => !await isActive(session.id), `inline ${mime}`)
      expect(requests.slice(before).some((request) => request.text.includes(`data:${mime};base64,`))).toBe(true)
    }
  }, 60_000)

  // The adapter forwards `file:///workspace/...` URIs unchanged (see the HTTP
  // regressions); locally the workspace is not at /workspace, so the native
  // handling of each V1 attachment form is exercised through the raw client.
  it('resolves every V1 workspace attachment form from its file URI', async () => {
    const directory = join(workspace, '.arche/attachments')
    await mkdir(directory, { recursive: true })
    const files: Array<[string, Buffer, string | null]> = [
      ['notes.md', Buffer.from('# MD_CONTENT\n'), 'MD_CONTENT'],
      ['data.json', Buffer.from('{"JSON_CONTENT":1}\n'), 'JSON_CONTENT'],
      ['data.xml', Buffer.from('<x>XML_CONTENT</x>\n'), 'XML_CONTENT'],
      ['run.log', Buffer.from('LOG_CONTENT\n'), 'LOG_CONTENT'],
      ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">SVG_CONTENT</svg>\n'), 'SVG_CONTENT'],
      ['bundle.zip', Buffer.from('504b0506000000000000000000000000000000000000', 'hex'), null],
      ['pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'), 'data:image/png;base64,'],
      ['pixel.jpg', Buffer.from(JPEG_BASE64, 'base64'), 'data:image/jpeg;base64,'],
      ['pixel.gif', Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'), 'data:image/gif;base64,'],
      ['pixel.webp', Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64'), 'data:image/webp;base64,'],
    ]
    for (const [name, data, marker] of files) {
      await writeFile(join(directory, name), data)
      const session = await create(`file-${name}`)
      const before = requests.length
      await client.session.prompt({ sessionID: session.id, text: `ATTACH ${name}`, files: [{ uri: pathToFileURL(join(directory, name)).href, name }] })
      await waitFor(async () => !await isActive(session.id), `file ${name}`)
      const user = (await client.message.list({ sessionID: session.id })).data.find((message) => message.type === 'user')
      expect(user?.type === 'user' && user.files?.map((file) => file.name)).toEqual([name])
      expect(requests.length).toBeGreaterThan(before)
      if (marker) expect(requests.slice(before).some((request) => request.text.includes(marker))).toBe(true)
    }
  }, 60_000)
})
