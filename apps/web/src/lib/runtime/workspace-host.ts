import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'

let workspaceHostPromise: Promise<WorkspaceHost> | null = null

async function getWorkspaceHost(): Promise<WorkspaceHost> {
  if (workspaceHostPromise) {
    return workspaceHostPromise
  }

  const caps = getRuntimeCapabilities()

  workspaceHostPromise = caps.containers
    ? import('@/lib/runtime/workspace-host-web').then((module) => module.webWorkspaceHost)
    : import('@/lib/runtime/workspace-host-desktop').then((module) => module.desktopWorkspaceHost)

  return workspaceHostPromise
}

export async function startWorkspace(
  slug: string,
  userId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string; detail?: string }> {
  return (await getWorkspaceHost()).start(slug, userId)
}

export async function stopWorkspace(
  slug: string,
  userId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  return (await getWorkspaceHost()).stop(slug, userId)
}

export async function getWorkspaceStatus(
  slug: string,
): Promise<WorkspaceHostStatus | null> {
  return (await getWorkspaceHost()).getStatus(slug)
}

export async function getWorkspaceConnection(
  slug: string,
): Promise<WorkspaceHostConnection | null> {
  return (await getWorkspaceHost()).getConnection(slug)
}

export async function getWorkspaceAgentConnection(
  slug: string,
): Promise<WorkspaceHostConnection | null> {
  return (await getWorkspaceHost()).getAgentConnection(slug)
}

export async function isWorkspaceReachable(slug: string): Promise<boolean> {
  const status = await (await getWorkspaceHost()).getStatus(slug)
  return status?.status === 'running'
}
