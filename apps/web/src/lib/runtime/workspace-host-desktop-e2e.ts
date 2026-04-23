import { getE2eRuntimeConnection } from '@/lib/e2e/runtime'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { instanceService } from '@/lib/services'
import { encryptPassword } from '@/lib/spawner/crypto'

export const desktopWorkspaceHostE2e: WorkspaceHost = {
  async start(slug: string) {
    const connection = getE2eRuntimeConnection()
    if (!connection) {
      return { ok: false, error: 'start_failed', detail: 'missing_e2e_runtime_connection' }
    }

    await instanceService.upsertStarting(slug, encryptPassword(connection.password))
    await instanceService.setRunning(slug, null)
    // Mirror the desktop host contract, which reports a successful launch as started.
    return { ok: true, status: 'started' }
  },

  async stop(slug: string) {
    const instance = await instanceService.findStatusBySlug(slug)
    if (!instance || instance.status === 'stopped') {
      return { ok: true, status: 'already_stopped' }
    }

    await instanceService.setStopped(slug)
    return { ok: true, status: 'stopped' }
  },

  async getStatus(slug: string): Promise<WorkspaceHostStatus | null> {
    const instance = await instanceService.findStatusBySlug(slug)
    if (!instance) {
      return {
        status: 'stopped',
        startedAt: null,
        stoppedAt: null,
        lastActivityAt: null,
      }
    }

    return {
      status: instance.status,
      startedAt: instance.startedAt,
      stoppedAt: instance.stoppedAt,
      lastActivityAt: instance.lastActivityAt,
    }
  },

  async getConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const instance = await instanceService.findStatusBySlug(slug)
    if (!instance || instance.status !== 'running') {
      return null
    }

    const connection = getE2eRuntimeConnection()
    return connection
      ? { baseUrl: connection.baseUrl, authHeader: connection.authHeader }
      : null
  },

  async getAgentConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const instance = await instanceService.findStatusBySlug(slug)
    if (!instance || instance.status !== 'running') {
      return null
    }

    const connection = getE2eRuntimeConnection()
    return connection
      ? { baseUrl: connection.baseUrl, authHeader: connection.authHeader }
      : null
  },
}
