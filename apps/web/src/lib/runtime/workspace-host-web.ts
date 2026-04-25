import { isE2eFakeRuntimeEnabled } from '@/lib/e2e/runtime'
import { getInstanceBasicAuth } from '@/lib/opencode/client'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { webWorkspaceHostE2e } from '@/lib/runtime/workspace-host-web-e2e'
import { startInstance, stopInstance, getInstanceStatus } from '@/lib/spawner/core'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

const webWorkspaceHostReal: WorkspaceHost = {
  async start(slug: string, userId: string) {
    return startInstance(slug, userId)
  },

  async stop(slug: string, userId: string) {
    return stopInstance(slug, userId)
  },

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

export const webWorkspaceHost: WorkspaceHost = isE2eFakeRuntimeEnabled()
  ? webWorkspaceHostE2e
  : webWorkspaceHostReal
