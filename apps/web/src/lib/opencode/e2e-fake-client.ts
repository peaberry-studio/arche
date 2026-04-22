import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

type E2eSessionRecord = {
  createdAt?: number
  id?: string
  status?: string
  title?: string
  updatedAt?: number
}

type E2eMessageRecord = {
  createdAt?: number
  id?: string
  role?: string
  sessionId?: string
  text?: string
}

async function fetchE2eRuntimeJson<T>(
  baseUrl: string,
  authHeader: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

function mapE2eSession(session: E2eSessionRecord | undefined) {
  return {
    id: session?.id ?? '',
    title: session?.title ?? session?.id ?? 'Untitled',
    parentID: null,
    time: {
      created: session?.createdAt,
      updated: session?.updatedAt,
    },
  }
}

function listFilesAtPath(
  files: Array<{ hash?: string; modifiedAt?: number; path?: string; size?: number }>,
  path: string,
) {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const entries = new Map<
    string,
    {
      hash?: string
      ignored: boolean
      modifiedAt?: number
      name: string
      path: string
      size?: number
      type: 'directory' | 'file'
    }
  >()

  for (const file of files) {
    const filePath = file.path?.replace(/^\/+|\/+$/g, '')
    if (!filePath) {
      continue
    }

    const parts = filePath.split('/')
    const parentParts = normalizedPath ? normalizedPath.split('/') : []

    if (parentParts.length > parts.length || !parentParts.every((part, index) => parts[index] === part)) {
      continue
    }

    const remainder = parts.slice(parentParts.length)
    if (remainder.length === 0) {
      continue
    }

    if (remainder.length === 1) {
      entries.set(filePath, {
        hash: file.hash,
        ignored: false,
        modifiedAt: file.modifiedAt,
        name: remainder[0],
        path: filePath,
        size: file.size,
        type: 'file',
      })
      continue
    }

    const directoryPath = [...parentParts, remainder[0]].join('/')
    if (!entries.has(directoryPath)) {
      entries.set(directoryPath, {
        ignored: false,
        name: remainder[0],
        path: directoryPath,
        type: 'directory',
      })
    }
  }

  return Array.from(entries.values()).sort((left, right) => left.path.localeCompare(right.path))
}

export function createE2eFakeClient(baseUrl: string, authHeader: string): OpencodeClient {
  // Keep this list in sync with scripts/e2e/fake-runtime-server.mjs.
  // The fake runtime only supports the OpenCode operations Arche exercises in
  // smoke flows: global.health, session.list/create/update/delete/messages/status,
  // file.list, config.providers, and app.agents.
  const client = {
    global: {
      health: async () => {
        const data = await fetchE2eRuntimeJson<{ version?: string }>(baseUrl, authHeader, '/__e2e/health')
        return { data: { healthy: true, version: data.version ?? 'e2e-fake-runtime' } }
      },
    },
    session: {
      list: async () => {
        const response = await fetchE2eRuntimeJson<{ sessions?: E2eSessionRecord[] }>(baseUrl, authHeader, '/__e2e/sessions')
        return { data: (response.sessions ?? []).map((session) => mapE2eSession(session)) }
      },
      create: async (parameters?: { title?: string }) => {
        const response = await fetchE2eRuntimeJson<{ session?: E2eSessionRecord }>(
          baseUrl,
          authHeader,
          '/__e2e/sessions',
          {
            method: 'POST',
            body: JSON.stringify({ title: parameters?.title }),
          },
        )
        return { data: response.session ? mapE2eSession(response.session) : null }
      },
      update: async (parameters: { sessionID: string; title?: string }) => {
        const response = await fetchE2eRuntimeJson<{ session?: E2eSessionRecord }>(
          baseUrl,
          authHeader,
          `/__e2e/sessions/${parameters.sessionID}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ title: parameters.title }),
          },
        )
        return { data: response.session ? mapE2eSession(response.session) : null }
      },
      delete: async (parameters: { sessionID: string }) => {
        await fetchE2eRuntimeJson(baseUrl, authHeader, `/__e2e/sessions/${parameters.sessionID}`, {
          method: 'DELETE',
        })
        return { data: null }
      },
      messages: async (parameters: { sessionID: string }) => {
        const response = await fetchE2eRuntimeJson<{ messages?: E2eMessageRecord[] }>(
          baseUrl,
          authHeader,
          `/__e2e/sessions/${parameters.sessionID}/messages`,
        )

        return {
          data: (response.messages ?? []).map((message) => ({
            info: {
              id: message.id ?? '',
              role: message.role,
              sessionID: message.sessionId ?? parameters.sessionID,
              ...(message.role === 'assistant'
                ? {
                    agent: 'assistant',
                    modelID: 'e2e-model',
                    providerID: 'e2e-provider',
                  }
                : {}),
              time: { created: message.createdAt },
            },
            parts: [{ type: 'text', text: message.text ?? '' }],
          })),
        }
      },
      status: async () => {
        const response = await fetchE2eRuntimeJson<{ sessions?: Array<{ id?: string; status?: string }> }>(
          baseUrl,
          authHeader,
          '/__e2e/sessions/status',
        )

        const data = Object.fromEntries(
          (response.sessions ?? [])
            .filter((session): session is { id: string; status?: string } => typeof session.id === 'string')
            .map((session) => [session.id, { type: session.status === 'busy' ? 'busy' : 'idle' }]),
        )

        return { data }
      },
    },
    file: {
      list: async (parameters?: { path?: string }) => {
        const response = await fetchE2eRuntimeJson<{
          files?: Array<{ hash?: string; modifiedAt?: number; path?: string; size?: number }>
        }>(baseUrl, authHeader, '/__e2e/files')
        return { data: listFilesAtPath(response.files ?? [], parameters?.path ?? '') }
      },
    },
    config: {
      providers: async () => {
        const response = await fetchE2eRuntimeJson<{
          providers?: Array<{ id?: string; name?: string }>
        }>(baseUrl, authHeader, '/__e2e/providers')

        return {
          data: {
            default: { 'e2e-provider': 'e2e-model' },
            providers: (response.providers ?? []).map((provider) => ({
              id: provider.id ?? 'e2e-provider',
              name: provider.name ?? 'E2E Provider',
              models: {
                'e2e-model': {
                  cost: { input: 0, output: 0 },
                  name: 'E2E Model',
                },
              },
            })),
          },
        }
      },
    },
    app: {
      agents: async () => {
        const response = await fetchE2eRuntimeJson<{
          agents?: Array<{ id?: string; name?: string; description?: string }>
        }>(baseUrl, authHeader, '/__e2e/agents')

        return {
          data: (response.agents ?? []).map((agent) => ({
            name: agent.id ?? agent.name ?? 'assistant',
            description: agent.description ?? agent.name,
          })),
        }
      },
    },
  }

  return client as unknown as OpencodeClient
}
