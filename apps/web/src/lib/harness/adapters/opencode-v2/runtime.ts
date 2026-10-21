import type { SessionInfo, SessionMessageInfo, SessionPromptInput } from '@opencode/client'

import { checkHealth, createInstanceClient, normalizeOpenCodeError, type OpenCodeV2Client } from '@/lib/harness/adapters/opencode-v2/client'
import { subscribeOpenCodeEvents } from '@/lib/harness/adapters/opencode-v2/events'
import { syncProviderAccess } from '@/lib/harness/adapters/opencode-v2/providers'
import { toArchePermission, toHarnessMessage, toHarnessSession, toInboxMessage } from '@/lib/harness/adapters/opencode-v2/transform'
import type { HarnessRuntime, HarnessSession } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getCanonicalProviderId, getProviderLabel, resolveRuntimeProviderId } from '@/lib/providers/catalog'

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

  return {
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
    sessionStatus: async () => harnessFailure('runtime_unsupported', 'v2_family_idle_confirmation_unverified'),
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
      const session = await withClient((client) => client.session.get({ sessionID: input.sessionId }, options))
      if (!session.ok) return session
      if (input.noReply) return harnessFailure('runtime_unsupported', 'v2_no_reply_unavailable:resume_false_queues_without_delivery')
      const files: Array<NonNullable<SessionPromptInput['files']>[number]> = []
      for (const part of input.parts) {
        if (part.type !== 'file') continue
        if (part.url.startsWith('data:image/png;base64,') && part.mime === 'image/png') {
          files.push({ uri: part.url, name: part.filename })
          continue
        }
        let url: URL
        try { url = new URL(part.url) } catch { return harnessFailure('runtime_unsupported', 'v2_prompt_file_uri_unverified') }
        let path: string
        try { path = decodeURIComponent(url.pathname) } catch { return harnessFailure('runtime_unsupported', 'v2_prompt_file_uri_unverified') }
        if (url.protocol !== 'file:' || url.host || url.search || url.hash || !path.startsWith('/workspace/') || path.includes('\\') || path.split('/').some((segment) => segment === '.' || segment === '..')) {
          return harnessFailure('runtime_unsupported', 'v2_prompt_file_uri_unverified')
        }
        if (!((part.mime === 'text/plain' && path.endsWith('.txt')) || (part.mime === 'image/png' && path.endsWith('.png')) || part.mime === 'application/x-directory')) {
          return harnessFailure('runtime_unsupported', 'v2_prompt_file_mime_unverified')
        }
        files.push({ uri: part.url, name: part.filename })
      }
      return withClient(async (client) => {
        if (input.agent && input.agent !== session.data.agent) await client.session.switchAgent({ sessionID: input.sessionId, agent: input.agent }, options)
        const model = input.model ? { providerID: resolveRuntimeProviderId(input.model.providerId), id: input.model.modelId } : undefined
        if (model && (model.providerID !== session.data.model?.providerID || model.id !== session.data.model.id)) {
          await client.session.switchModel({ sessionID: input.sessionId, model }, options)
        }
        await client.session.prompt({
          sessionID: input.sessionId, id: input.messageId,
          text: input.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n'),
          ...(files.length > 0 && { files }),
        }, options)
      })
    },
    sendMessage: async () => harnessFailure('runtime_unsupported', 'v2_synchronous_prompt_unverified'),
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
}
