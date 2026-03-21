import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { desktopWorkspaceHost } from '@/lib/runtime/workspace-host-desktop'
import { webWorkspaceHost } from '@/lib/runtime/workspace-host-web'

function getWorkspaceHost(): WorkspaceHost {
  const caps = getRuntimeCapabilities()
  return caps.containers ? webWorkspaceHost : desktopWorkspaceHost
}

export async function startWorkspace(
  slug: string,
  userId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string; detail?: string }> {
  return getWorkspaceHost().start(slug, userId)
}

export async function stopWorkspace(
  slug: string,
  userId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  return getWorkspaceHost().stop(slug, userId)
}

export async function getWorkspaceStatus(
  slug: string,
): Promise<WorkspaceHostStatus | null> {
  return getWorkspaceHost().getStatus(slug)
}

export async function getWorkspaceConnection(
  slug: string,
): Promise<WorkspaceHostConnection | null> {
  return getWorkspaceHost().getConnection(slug)
}

export async function getWorkspaceAgentConnection(
  slug: string,
): Promise<WorkspaceHostConnection | null> {
  return getWorkspaceHost().getAgentConnection(slug)
}

export async function isWorkspaceReachable(slug: string): Promise<boolean> {
  const status = await getWorkspaceHost().getStatus(slug)
  return status?.status === 'running'
}
