import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'

export const desktopWorkspaceHost: WorkspaceHost = {
  async start(): Promise<{ ok: false; error: string }> {
    return { ok: false, error: 'not_implemented' }
  },

  async stop(): Promise<{ ok: false; error: string }> {
    return { ok: false, error: 'not_implemented' }
  },

  async getStatus(): Promise<WorkspaceHostStatus | null> {
    return null
  },

  async getConnection(): Promise<WorkspaceHostConnection | null> {
    return null
  },

  async getAgentConnection(): Promise<WorkspaceHostConnection | null> {
    return null
  },
}
