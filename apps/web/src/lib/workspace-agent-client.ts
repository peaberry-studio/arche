type JsonObject = Record<string, unknown>

export type WorkspaceAgent = {
  baseUrl: string
  authHeader: string
}

export type AgentResponse<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number }

export async function workspaceAgentFetch<T extends JsonObject>(
  agent: WorkspaceAgent,
  endpoint: string,
  body?: Record<string, unknown>,
  options?: { method?: string },
): Promise<AgentResponse<T>> {
  const response = await fetch(`${agent.baseUrl}${endpoint}`, {
    method: options?.method ?? 'POST',
    headers: {
      Authorization: agent.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  })

  const json = (await response.json().catch(() => null)) as JsonObject | null
  if (!json) {
    return { ok: false, error: 'non-json response', status: response.status }
  }

  const error = typeof json.error === 'string' ? json.error : null
  const ok = json.ok

  if (!response.ok) {
    return {
      ok: false,
      error: error ?? `workspace_agent_http_${response.status}`,
      status: response.status,
    }
  }

  if (ok === false) {
    return {
      ok: false,
      error: error ?? 'workspace_agent_error',
      status: response.status,
    }
  }

  return { ok: true, data: json as T, status: response.status }
}
