import type { SessionInboxUser, SessionInfo, SessionMessageInfo, SessionPromptInput } from '@opencode/client'

import { checkHealth, createInstanceClient, normalizeOpenCodeError, type OpenCodeV2Client } from '@/lib/harness/adapters/opencode-v2/client'
import { subscribeOpenCodeEvents } from '@/lib/harness/adapters/opencode-v2/events'
import { syncProviderAccess } from '@/lib/harness/adapters/opencode-v2/providers'
import { toArchePermission, toHarnessMessage, toHarnessSession, toInboxMessage } from '@/lib/harness/adapters/opencode-v2/transform'
import type {
  HarnessOperationOptions,
  HarnessPrompt,
  HarnessPromptPart,
  HarnessRuntime,
  HarnessSession,
  HarnessSessionStatus,
} from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getCanonicalProviderId, getProviderLabel, resolveRuntimeProviderId } from '@/lib/providers/catalog'

type PromptFile = NonNullable<SessionPromptInput['files']>[number]

// The image forms V1's prompt builder inlines; the runtime sniffs the bytes.
const INLINE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const SYNC_FAMILY_IDLE_TIMEOUT_MS = 60_000
const SYNC_FAMILY_IDLE_POLL_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Workspace file URIs resolve inside the container whatever their MIME type,
// matching the V1 builder; anything outside `/workspace/` is refused.
function toPromptFile(part: Extract<HarnessPromptPart, { type: 'file' }>): PromptFile | null {
  if (part.url.startsWith('data:')) {
    return INLINE_IMAGE_MIME_TYPES.has(part.mime) && part.url.startsWith(`data:${part.mime};base64,`)
      ? { uri: part.url, name: part.filename } : null
  }
  let url: URL
  let path: string
  try {
    url = new URL(part.url)
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (url.protocol !== 'file:' || url.host || url.search || url.hash || !path.startsWith('/workspace/') || path.includes('\\') ||
    path.split('/').some((segment) => segment === '.' || segment === '..')) return null
  return { uri: part.url, name: part.filename }
}

async function collectPages<T extends { id: string }>(fetchPage: (cursor?: string) => Promise<{ data: T[]; cursor: { next?: string | null } }>, limit?: number): Promise<T[]> {
  const items = new Map<string, T>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const page = await fetchPage(cursor)
    for (const item of page.data) items.set(item.id, item)
    if (limit !== undefined && items.size >= limit) return [...items.values()].slice(0, limit)
    if (page.cursor.next === null || page.cursor.next === undefined) return [...items.values()]
    if (seenCursors.has(page.cursor.next)) throw new Error('V2 pagination cursor repeated')
    seenCursors.add(page.cursor.next)
    cursor = page.cursor.next
  }
}

function requireSession(value: unknown): HarnessSession {
  const session = toHarnessSession(value)
  if (!session) throw new Error('Invalid V2 session response')
  return session
}

export function checkStartupSupport(): HarnessResult<void> {
  return harnessFailure('runtime_unsupported', 'v2_startup_unverified:protected_config,provider_gateway,family_idle,event_stream,prompt_parts')
}

export function createOpenCodeV2Runtime(slug: string): HarnessRuntime {
  async function withClient<T>(work: (client: OpenCodeV2Client) => Promise<T>): Promise<HarnessResult<T>> {
    try {
      const client = await createInstanceClient(slug)
      if (!client) return harnessFailure('instance_unavailable')
      return { ok: true, data: await work(client) }
    } catch (error) { return normalizeOpenCodeError(error) }
  }

  async function listSessions(client: OpenCodeV2Client, parentID?: string | null, limit?: number): Promise<HarnessSession[]> {
    const { directory } = await client.location.get()
    const sessions = await collectPages<SessionInfo>((cursor) => client.session.list({ directory, parentID, order: 'desc', limit: 100, cursor }), limit)
    return sessions.map(requireSession)
  }

  // No native no-reply exists on 2.0.32: `resume:false` keeps the input in the
  // inbox, idle and undelivered, and the next prompt delivers it ahead of its
  // own text, so the model sees it exactly once, as with V1 `noReply`.
  async function submitPrompt(input: HarnessPrompt, options?: HarnessOperationOptions): Promise<HarnessResult<SessionInboxUser>> {
    const session = await withClient((client) => client.session.get({ sessionID: input.sessionId }, options))
    if (!session.ok) return session
    const files: PromptFile[] = []
    for (const part of input.parts) {
      if (part.type !== 'file') continue
      const file = toPromptFile(part)
      if (!file) return harnessFailure('runtime_unsupported', 'v2_prompt_file_uri_unsupported')
      files.push(file)
    }
    return withClient(async (client) => {
      if (input.agent && input.agent !== session.data.agent) await client.session.switchAgent({ sessionID: input.sessionId, agent: input.agent }, options)
      const model = input.model ? { providerID: resolveRuntimeProviderId(input.model.providerId), id: input.model.modelId } : undefined
      if (model && (model.providerID !== session.data.model?.providerID || model.id !== session.data.model.id)) {
        await client.session.switchModel({ sessionID: input.sessionId, model }, options)
      }
      return client.session.prompt({
        sessionID: input.sessionId, id: input.messageId,
        text: input.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n'),
        ...(files.length > 0 && { files }),
        ...(input.noReply && { resume: false }),
      }, options)
    })
  }

  const runtime: HarnessRuntime = {
    kind: 'opencode-v2',
    slug,
    health: (options) => checkHealth(slug, options),
    createSession: (input = {}) => withClient(async (client) => {
      const location = await client.location.get()
      if (input.parentId) await client.session.get({ sessionID: input.parentId })
      return requireSession(await client.session.create({ title: input.title, parentID: input.parentId, location: { directory: location.directory } }))
    }),
    getSession: (sessionId) => withClient(async (client) => requireSession(await client.session.get({ sessionID: sessionId }))),
    listSessions(options = {}) {
      if (options.start !== undefined) return Promise.resolve(harnessFailure('runtime_unsupported', 'v2_session_start_filter_unverified'))
      return withClient((client) => listSessions(client, options.rootsOnly ? null : undefined, options.limit))
    },
    listChildren: (sessionId) => withClient(async (client) => {
      await client.session.get({ sessionID: sessionId })
      return listSessions(client, sessionId)
    }),
    updateSession: (sessionId, title) => withClient(async (client) => {
      await client.session.update({ sessionID: sessionId, title })
      return requireSession(await client.session.get({ sessionID: sessionId }))
    }),
    deleteSession: (sessionId) => withClient((client) => client.session.remove({ sessionID: sessionId })),
    // `active()` lists every session with a running drain, including retry
    // backoff, permission waits and backgrounded children; absence is idle,
    // as with V1. Inbox items left by a no-reply prompt are deliberately not
    // busy: they only run with the next prompt.
    sessionStatus: (options) => withClient(async (client) => Object.fromEntries(
      Object.keys(await client.session.active(options)).map((id): [string, HarnessSessionStatus] => [id, { type: 'busy' }]),
    )),
    listMessages: (sessionId) => withClient(async (client) => {
      await client.session.get({ sessionID: sessionId })
      const inbox = await client.session.inbox.list({ sessionID: sessionId })
      const messages = await collectPages<SessionMessageInfo>((cursor) => client.message.list({ sessionID: sessionId, limit: 100, ...(cursor ? { cursor } : { order: 'asc' }) }))
      const delivered = new Set(messages.map((message) => message.id))
      return [
        ...messages.map((message) => toHarnessMessage({ ...message, sessionID: sessionId })),
        ...inbox.filter((item) => !delivered.has(item.id)).map((item) => toInboxMessage(sessionId, item)),
      ].flatMap((message) => message ? [message] : [])
    }),
    async prompt(input, options) {
      const submitted = await submitPrompt(input, options)
      return submitted.ok ? { ok: true, data: undefined } : submitted
    },
    async sendMessage(input) {
      const execution = await import('@/lib/harness/execution')
      try {
        const cursor = await execution.captureSessionMessageCursor(runtime, input.sessionId)
        const submitted = await submitPrompt(input)
        if (!submitted.ok) return submitted
        if (input.noReply) {
          const message = toHarnessMessage({ ...submitted.data.payload, id: submitted.data.id, sessionID: input.sessionId, time: submitted.data.time, type: 'user' })
          return message ? { ok: true, data: message } : harnessFailure('runtime_error', 'Invalid V2 inbox response')
        }
        const completion = await execution.waitForSessionToComplete({ client: runtime, cursor, sessionId: input.sessionId, slug })
        if (completion.status === 'termination_unconfirmed') return harnessFailure('execution_termination_unconfirmed', completion.cause)
        const familyDeadline = Date.now() + SYNC_FAMILY_IDLE_TIMEOUT_MS
        while (await execution.readSessionFamilyRuntimeState(runtime, input.sessionId) !== 'idle') {
          if (Date.now() >= familyDeadline) return harnessFailure('session_busy', 'v2_family_not_idle_after_reply')
          await sleep(SYNC_FAMILY_IDLE_POLL_MS)
        }
        const messages = await runtime.listMessages(input.sessionId)
        if (!messages.ok) return messages
        const reply = messages.data.slice(cursor.messageCount).findLast((message) => message.role === 'assistant')
        if (reply) return { ok: true, data: reply }
        return harnessFailure('runtime_error', completion.status === 'failed' ? completion.error : 'flow_no_assistant_message')
      } catch (error) {
        return harnessFailure('runtime_error', error instanceof Error ? error.message : undefined)
      }
    },
    abortSession: async (sessionId) => {
      const result = await withClient(async (client) => {
        await client.session.get({ sessionID: sessionId })
        await client.session.interrupt({ sessionID: sessionId, resume: false })
        for (const item of await client.session.inbox.list({ sessionID: sessionId })) {
          await client.session.inbox.cancel({ sessionID: sessionId, inboxID: item.id })
        }
        return client.session.inbox.list({ sessionID: sessionId })
      })
      if (!result.ok) return result
      return result.data.length === 0 ? { ok: true, data: undefined } : harnessFailure('execution_termination_unconfirmed', 'v2_inbox_not_empty_after_interrupt')
    },
    listPermissions: () => withClient(async (client) => (await client.permission.request.list()).data.flatMap((permission) => {
      const normalized = toArchePermission(permission)
      if (!normalized) return []
      const { permissionType, ...rest } = normalized
      return [{ ...rest, kind: permissionType }]
    })),
    replyPermission: (input, options) => withClient(async (client) => {
      await client.permission.reply({ sessionID: input.sessionId, requestID: input.permissionId, decision: input.response }, options)
    }),
    listModels: () => withClient(async (client) => {
      const [models, defaultModel] = await Promise.all([client.model.list(), client.model.default()])
      return models.data.filter((model) => model.enabled).map((model) => {
        const providerId = getCanonicalProviderId(model.providerID) ?? model.providerID
        const cost = model.cost.find((cost) => cost.tier === undefined)
        return {
          providerId, providerName: getProviderLabel(providerId), modelId: model.id, modelName: model.name,
          isDefault: defaultModel.data?.providerID === model.providerID && defaultModel.data.id === model.id,
          ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
        }
      })
    }),
    listAgents: () => withClient(async (client) => (await client.agent.list()).data.map((agent) => ({
      id: agent.id, name: agent.name, description: agent.description,
      ...(agent.model ? { model: { providerId: getCanonicalProviderId(agent.model.providerID) ?? agent.model.providerID, modelId: agent.model.id } } : {}),
    }))),
    listConnectorKeys: () => withClient(async (client) => (await client.mcp.list()).data.map((server) => server.name)),
    listConnectorStatus: () => withClient(async (client) => Object.fromEntries((await client.mcp.list()).data.map((server) => [server.name, server.status.status === 'connected']))),
    sessionDiff: (sessionId) => withClient(async (client) => (await client.session.diff({ sessionID: sessionId })).map((diff) => ({
      path: diff.file, status: diff.status, additions: diff.additions, deletions: diff.deletions, diff: diff.patch,
    }))),
    syncProviderAccess: (input) => syncProviderAccess(slug, input),
    subscribeEvents: (signal) => subscribeOpenCodeEvents(slug, signal),
  }
  return runtime
}
