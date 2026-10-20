import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

import {
  createInstanceClient,
  DEFAULT_HEALTH_TIMEOUT_MS,
  getInstanceBasicAuth,
  isInstanceHealthyWithPassword,
} from '@/lib/harness/adapters/opencode-v1/client'
import { subscribeOpenCodeEvents } from '@/lib/harness/adapters/opencode-v1/events'
import { normalizePendingPermission } from '@/lib/harness/adapters/opencode-v1/permission'
import { ensureProviderAccessFreshForExecution, syncProviderAccessForInstance } from '@/lib/harness/adapters/opencode-v1/providers'
import { toHarnessMessage, toHarnessSession } from '@/lib/harness/adapters/opencode-v1/transform'
import type { HarnessPrompt, HarnessRuntime, HarnessSession, HarnessSessionStatus } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getCanonicalProviderId, getProviderLabel, resolveRuntimeProviderId } from '@/lib/providers/catalog'
import { getString, isRecord } from '@/lib/records'

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeOpenCodeError(error: unknown): ReturnType<typeof harnessFailure> {
  const record = isRecord(error) ? error : {}
  const response = isRecord(record.response) ? record.response : {}
  const cause = isRecord(record.cause) ? record.cause : {}
  const parsedStatus = Number(record.status ?? record.statusCode ?? response.status ?? response.statusCode ?? cause.status)
  const status = Number.isFinite(parsedStatus) ? parsedStatus : undefined
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error :
    getString(record.message) ?? getString(response.statusText) ?? getString(cause.message)
  const code = getString(record.code) ?? getString(record.name) ?? getString(cause.code) ?? ''
  if (status === 404 || /session.*not.*found|session_not_found/i.test(code) ||
    /session.*not\s*found|session.*missing|no session.*found|404.*session/i.test(detail ?? '')) {
    return harnessFailure('session_not_found', detail, status)
  }
  if (status === 409 || /session.*busy|session_busy/i.test(code)) return harnessFailure('session_busy', detail, status)
  return harnessFailure('runtime_error', detail, status)
}

function requireSession(value: unknown): HarnessSession {
  const session = toHarnessSession(value)
  if (!session) throw new Error('Invalid session response')
  return session
}

function normalizeHealthFailure(detail: string, message?: string): ReturnType<typeof harnessFailure> {
  switch (detail) {
    case 'healthcheck_timeout':
    case 'dns_resolution_error':
    case 'connection_refused':
    case 'connect_timeout':
    case 'fetch_failed':
    case 'invalid_json':
    case 'unhealthy_response':
      return harnessFailure(detail, message)
    default:
      if (/^http_status_\d+$/.test(detail)) return harnessFailure(`http_status_${Number(detail.slice('http_status_'.length))}`, message)
      return harnessFailure('runtime_error', message ?? detail)
  }
}

function promptParameters(input: HarnessPrompt) {
  return {
    sessionID: input.sessionId,
    messageID: input.messageId,
    parts: input.parts,
    agent: input.agent,
    noReply: input.noReply,
    model: input.model ? { providerID: resolveRuntimeProviderId(input.model.providerId), modelID: input.model.modelId } : undefined,
  }
}

export function createOpenCodeV1Runtime(slug: string): HarnessRuntime {
  async function withClient<T>(work: (client: OpencodeClient) => Promise<T>): Promise<HarnessResult<T>> {
    try {
      const client = await createInstanceClient(slug)
      if (!client) return harnessFailure('instance_unavailable')
      return { ok: true, data: await work(client) }
    } catch (error) {
      return normalizeOpenCodeError(error)
    }
  }

  return {
    kind: 'opencode-v1',
    slug,
    async health(options) {
      if (options?.password !== undefined) {
        const result = await isInstanceHealthyWithPassword(slug, options.password, options.baseUrl, options)
        return result.ok ? { ok: true, data: {} } : normalizeHealthFailure(result.detail, result.message)
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS)
      const abort = () => controller.abort()
      options?.signal?.addEventListener('abort', abort, { once: true })
      if (options?.signal?.aborted) controller.abort()
      try {
        const result = await withClient(async (client) => {
          const response = await client.global.health({ signal: controller.signal, throwOnError: true })
          return response.data
        })
        if (controller.signal.aborted) return harnessFailure('healthcheck_timeout')
        if (!result.ok) return result
        return result.data?.healthy ? { ok: true, data: { version: result.data.version } } : harnessFailure('unhealthy_response')
      } finally {
        clearTimeout(timeout)
        options?.signal?.removeEventListener('abort', abort)
      }
    },
    createSession: (input = {}) => withClient(async (client) => requireSession((await client.session.create({ title: input.title, parentID: input.parentId }, { throwOnError: true })).data)),
    getSession: (sessionId) => withClient(async (client) => requireSession((await client.session.get({ sessionID: sessionId }, { throwOnError: true })).data)),
    listSessions: (options = {}) => withClient(async (client) => (await client.session.list({ limit: options.limit, roots: options.rootsOnly, start: options.start }, { throwOnError: true })).data.map(requireSession)),
    listChildren: (sessionId) => withClient(async (client) => (await client.session.children({ sessionID: sessionId }, { throwOnError: true })).data.map(requireSession)),
    updateSession: (sessionId, title) => withClient(async (client) => requireSession((await client.session.update({ sessionID: sessionId, title }, { throwOnError: true })).data)),
    deleteSession: (sessionId) => withClient(async (client) => { await client.session.delete({ sessionID: sessionId }, { throwOnError: true }) }),
    sessionStatus: (options) => withClient(async (client) => {
      const response = await client.session.status({}, { throwOnError: true, ...options })
      return Object.fromEntries(Object.entries(response.data).map(([id, value]): [string, HarnessSessionStatus] => {
        if (value.type === 'busy' || value.type === 'idle') return [id, { type: value.type }]
        const record: unknown = value
        if (isRecord(record) && record.type === 'retry') {
          const action = isRecord(record.action) ? record.action : {}
          return [id, {
            type: 'retry', attempt: getNumber(record.attempt), message: getString(record.message), next: getNumber(record.next),
            ...(action.reason === 'free_tier_limit' && { terminalError: 'free_tier_limit' }),
          }]
        }
        return [id, { type: 'unknown' }]
      }))
    }),
    listMessages: (sessionId) => withClient(async (client) => {
      const response = await client.session.messages({ sessionID: sessionId }, { throwOnError: true })
      return response.data.flatMap((message) => {
        const normalized = toHarnessMessage({ ...message.info, sessionID: sessionId, parts: message.parts })
        return normalized ? [normalized] : []
      })
    }),
    prompt: (input, options) => withClient(async (client) => { await client.session.promptAsync(promptParameters(input), { throwOnError: true, ...options }) }),
    async sendMessage(input) {
      try {
        const connection = await getInstanceBasicAuth(slug)
        if (!connection) return harnessFailure('instance_unavailable')
        const parameters = promptParameters(input)
        const response = await fetch(`${connection.baseUrl}/session/${encodeURIComponent(input.sessionId)}/message`, {
          method: 'POST',
          headers: { Authorization: connection.authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageID: parameters.messageID, parts: parameters.parts, agent: parameters.agent, model: parameters.model, noReply: parameters.noReply }),
        })
        const text = await response.text()
        if (!response.ok) return normalizeOpenCodeError({ status: response.status, message: `HTTP ${response.status}: ${text}` })
        let id = ''
        let content = ''
        try {
          const value: unknown = JSON.parse(text)
          if (isRecord(value)) {
            id = isRecord(value.info) ? getString(value.info.id) ?? '' : ''
            if (Array.isArray(value.parts)) {
              content = value.parts.flatMap((part: unknown) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
            }
          }
        } catch {
          for (const line of text.split('\n')) {
            if (line.trim().startsWith('{')) {
              try {
                const event: unknown = JSON.parse(line)
                if (isRecord(event)) {
                  if (!id) id = getString(event.messageID) ?? ''
                  if (event.type === 'text' && typeof event.text === 'string') content += event.text
                }
              } catch {
                if (line.trim()) content += `${line}\n`
              }
            } else if (line.trim()) content += `${line}\n`
          }
          content = content.trim()
        }
        const message = toHarnessMessage({ id: id || `msg-${Date.now()}`, sessionID: input.sessionId, role: 'assistant', time: { created: Date.now() }, parts: [{ type: 'text', text: content }] })
        if (!message) return harnessFailure('runtime_error', 'Invalid message response')
        return { ok: true, data: message }
      } catch (error) {
        return normalizeOpenCodeError(error)
      }
    },
    abortSession: (sessionId) => withClient(async (client) => { await client.session.abort({ sessionID: sessionId }, { throwOnError: true }) }),
    listPermissions: () => withClient(async (client) => (await client.permission.list({}, { throwOnError: true })).data.flatMap((permission) => {
      const normalized = normalizePendingPermission(permission)
      return normalized ? [{ ...normalized, kind: permission.permission }] : []
    })),
    replyPermission: (input, options) => withClient(async (client) => { await client.permission.reply({ requestID: input.permissionId, reply: input.response }, { throwOnError: true, ...options }) }),
    listModels: () => withClient(async (client) => {
      const response = await client.config.providers({}, { throwOnError: true })
      return response.data.providers.flatMap((provider) => {
        const runtimeProviderId = String(provider.id)
        const providerId = getCanonicalProviderId(runtimeProviderId) ?? runtimeProviderId
        return Object.entries(provider.models).map(([modelId, model]) => ({
          providerId, providerName: provider.name ?? getProviderLabel(providerId), modelId, modelName: model.name ?? modelId,
          isDefault: response.data.default[runtimeProviderId] === modelId || response.data.default[providerId] === modelId,
          ...(model.cost && { cost: { input: model.cost.input, output: model.cost.output } }),
        }))
      })
    }),
    listAgents: () => withClient(async (client) => (await client.app.agents({}, { throwOnError: true })).data.map((agent) => ({
      id: agent.name, name: agent.name, description: agent.description,
      ...(agent.model && { model: { providerId: getCanonicalProviderId(agent.model.providerID) ?? agent.model.providerID, modelId: agent.model.modelID } }),
    }))),
    listConnectorKeys: () => withClient(async (client) => Object.keys((await client.config.get({}, { throwOnError: true })).data.mcp ?? {})),
    listConnectorStatus: () => withClient(async (client) => Object.fromEntries(Object.entries((await client.mcp.status({}, { throwOnError: true })).data).map(([key, value]) => [key, value.status === 'connected']))),
    sessionDiff: (sessionId) => withClient(async (client) => (await client.session.diff({ sessionID: sessionId }, { throwOnError: true })).data.flatMap((diff) => diff.file ? [{ path: diff.file, status: diff.status ?? 'modified', additions: diff.additions, deletions: diff.deletions, diff: diff.patch ?? '' }] : [])),
    async syncProviderAccess(input) {
      try {
        if (input.connection || input.disposeInstance !== undefined) {
          const instance = input.connection ?? await getInstanceBasicAuth(slug)
          if (!instance) return harnessFailure('instance_unavailable')
          const result = await syncProviderAccessForInstance({ instance, slug, userId: input.userId, disposeInstance: input.disposeInstance })
          return result.ok ? { ok: true, data: undefined } : harnessFailure(result.error)
        }
        await ensureProviderAccessFreshForExecution({ slug, userId: input.userId, force: input.force, ignoreActiveRunId: input.ignoreActiveRunId })
        return { ok: true, data: undefined }
      } catch (error) {
        return harnessFailure(error instanceof Error && error.message === 'instance_unavailable' ? 'instance_unavailable' : 'sync_failed', error instanceof Error ? error.message : undefined)
      }
    },
    subscribeEvents: (signal) => subscribeOpenCodeEvents(slug, signal),
  }
}
