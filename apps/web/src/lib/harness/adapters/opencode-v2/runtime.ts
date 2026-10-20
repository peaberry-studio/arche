import type { SessionInfo, SessionMessageInfo } from '@opencode/client'

import { checkHealth, createInstanceClient, normalizeOpenCodeError, type OpenCodeV2Client } from '@/lib/harness/adapters/opencode-v2/client'
import { subscribeOpenCodeEvents } from '@/lib/harness/adapters/opencode-v2/events'
import { syncProviderAccess } from '@/lib/harness/adapters/opencode-v2/providers'
import { toArchePermission, toHarnessMessage, toHarnessSession } from '@/lib/harness/adapters/opencode-v2/transform'
import type { HarnessRuntime, HarnessSession } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getCanonicalProviderId, getProviderLabel } from '@/lib/providers/catalog'

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
      const messages = await collectPages<SessionMessageInfo>((cursor) => client.message.list({ sessionID: sessionId, order: 'asc', limit: 100, cursor }))
      return messages.flatMap((message) => {
        const normalized = toHarnessMessage({ ...message, sessionID: sessionId })
        return normalized ? [normalized] : []
      })
    }),
    async prompt(input, options) {
      const session = await withClient((client) => client.session.get({ sessionID: input.sessionId }, options))
      if (!session.ok) return session
      if (input.noReply) return harnessFailure('runtime_unsupported', 'v2_no_reply_unavailable:resume_false_queues_without_delivery')
      if (input.parts.some((part) => part.type !== 'text')) return harnessFailure('runtime_unsupported', 'v2_prompt_file_parts_unverified')
      return withClient(async (client) => {
        if (input.agent && input.agent !== session.data.agent) await client.session.switchAgent({ sessionID: input.sessionId, agent: input.agent }, options)
        if (input.model && (input.model.providerId !== session.data.model?.providerID || input.model.modelId !== session.data.model.id)) {
          await client.session.switchModel({ sessionID: input.sessionId, model: { providerID: input.model.providerId, id: input.model.modelId } }, options)
        }
        await client.session.prompt({
          sessionID: input.sessionId, id: input.messageId,
          text: input.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n'),
        }, options)
      })
    },
    sendMessage: async () => harnessFailure('runtime_unsupported', 'v2_synchronous_prompt_unverified'),
    abortSession: (sessionId) => withClient(async (client) => {
      await client.session.get({ sessionID: sessionId })
      await client.session.interrupt({ sessionID: sessionId, resume: false })
    }),
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
