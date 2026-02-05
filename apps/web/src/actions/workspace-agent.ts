'use server'

import { cookies } from 'next/headers'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import type { WorkspaceFileContent } from '@/lib/opencode/types'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionFromToken(token)
}

async function authorizeWorkspace(slug: string) {
  const session = await getAuthenticatedUser()
  if (!session) return { ok: false as const, error: 'unauthorized' as const }
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false as const, error: 'forbidden' as const }
  }
  return { ok: true as const }
}

type AgentResponse = { ok: true } | { ok: false; error: string }

function extractAgentError(response: Response, data: AgentResponse): string | null {
  if (!response.ok) {
    return !data.ok ? data.error : `workspace_agent_http_${response.status}`
  }
  if (!data.ok) {
    return data.error
  }
  return null
}

export async function readWorkspaceFileAction(slug: string, path: string): Promise<{
  ok: boolean
  content?: WorkspaceFileContent
  hash?: string
  error?: string
}> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/files/read`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ path }),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse & {
      path?: string
      content?: string
      encoding?: 'utf-8' | 'base64'
      hash?: string
    }

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    let content = data.content ?? ''
    if (data.encoding === 'base64') {
      try {
        content = Buffer.from(content, 'base64').toString('utf-8')
      } catch {
        // Keep as-is if decoding fails
      }
    }

    return {
      ok: true,
      content: {
        path,
        content,
        type: 'raw'
      },
      hash: data.hash
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export async function writeWorkspaceFileAction(
  slug: string,
  path: string,
  content: string,
  expectedHash?: string
): Promise<{ ok: boolean; hash?: string; error?: string }> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/files/write`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ path, content, expectedHash }),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse & { hash?: string }

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    return { ok: true, hash: data.hash }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export async function deleteWorkspaceFileAction(
  slug: string,
  path: string
): Promise<{ ok: boolean; error?: string }> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/files/delete`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ path }),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export async function applyWorkspacePatchAction(
  slug: string,
  patch: string
): Promise<{ ok: boolean; error?: string }> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/files/apply_patch`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ patch }),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export type ConflictResolutionStrategy = 'ours' | 'theirs' | 'manual'

export type WorkspaceConflictDetails = {
  path: string
  ours: string
  theirs: string
  base?: string
  working?: string
}

export async function getWorkspaceConflictAction(
  slug: string,
  path: string
): Promise<{ ok: boolean; conflict?: WorkspaceConflictDetails; error?: string }> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/git/conflict`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ path }),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse & {
      path?: string
      ours?: string
      theirs?: string
      base?: string
      working?: string
    }

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    if (!data.path) {
      return { ok: false, error: 'conflict_not_found' }
    }

    return {
      ok: true,
      conflict: {
        path: data.path,
        ours: data.ours ?? '',
        theirs: data.theirs ?? '',
        base: data.base,
        working: data.working
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}

export async function resolveWorkspaceConflictAction(
  slug: string,
  payload: { path: string; strategy: ConflictResolutionStrategy; content?: string }
): Promise<{ ok: boolean; error?: string }> {
  const auth = await authorizeWorkspace(slug)
  if (!auth.ok) return { ok: false, error: auth.error }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) return { ok: false, error: 'instance_unavailable' }

  try {
    const response = await fetch(`${agent.baseUrl}/git/resolve`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    })

    const data = await response.json() as AgentResponse

    const err = extractAgentError(response, data)
    if (err) return { ok: false, error: err }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'workspace_agent_unreachable' }
  }
}
