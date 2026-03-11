import { getInstanceBasicAuth } from '@/lib/opencode/client'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { startInstance, stopInstance, getInstanceStatus } from '@/lib/spawner/core'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export const webWorkspaceHost: WorkspaceHost = {
  start: startInstance,

  stop: stopInstance,

  async getStatus(slug: string): Promise<WorkspaceHostStatus | null> {
    const instance = await getInstanceStatus(slug)
    if (!instance) return null
    return {
      status: instance.status,
      startedAt: instance.startedAt,
      stoppedAt: instance.stoppedAt,
      lastActivityAt: instance.lastActivityAt,
    }
  },

  async getConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    return getInstanceBasicAuth(slug)
  },

  async getAgentConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    return createWorkspaceAgentClient(slug)
  },
}
