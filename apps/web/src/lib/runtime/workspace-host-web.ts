import { getE2eRuntimeConnection, isE2eFakeRuntimeEnabled } from '@/lib/e2e/runtime'
import { getInstanceBasicAuth } from '@/lib/opencode/client'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { instanceService } from '@/lib/services'
import { startInstance, stopInstance, getInstanceStatus } from '@/lib/spawner/core'
import { encryptPassword } from '@/lib/spawner/crypto'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export const webWorkspaceHost: WorkspaceHost = {
  async start(slug: string, userId: string) {
    if (!isE2eFakeRuntimeEnabled()) {
      return startInstance(slug, userId)
    }

    const connection = getE2eRuntimeConnection()
    if (!connection) {
      return { ok: false, error: 'start_failed', detail: 'missing_e2e_runtime_connection' }
    }

    await instanceService.upsertStarting(slug, encryptPassword(connection.password))
    await instanceService.setRunning(slug, null)
    return { ok: true, status: 'running' }
  },

  async stop(slug: string, userId: string) {
    if (!isE2eFakeRuntimeEnabled()) {
      return stopInstance(slug, userId)
    }

    const instance = await instanceService.findStatusBySlug(slug)
    if (!instance || instance.status === 'stopped') {
      return { ok: false, error: 'not_running' }
    }

    await instanceService.setStopped(slug)
    return { ok: true, status: 'stopped' }
  },

  async getStatus(slug: string): Promise<WorkspaceHostStatus | null> {
    if (isE2eFakeRuntimeEnabled()) {
      const instance = await instanceService.findStatusBySlug(slug)
      if (!instance) {
        return null
      }

      return {
        status: instance.status,
        startedAt: instance.startedAt,
        stoppedAt: instance.stoppedAt,
        lastActivityAt: instance.lastActivityAt,
      }
    }

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
    if (isE2eFakeRuntimeEnabled()) {
      const instance = await instanceService.findStatusBySlug(slug)
      if (!instance || instance.status !== 'running') {
        return null
      }

      const connection = getE2eRuntimeConnection()
      return connection
        ? { baseUrl: connection.baseUrl, authHeader: connection.authHeader }
        : null
    }

    return getInstanceBasicAuth(slug)
  },

  async getAgentConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    if (isE2eFakeRuntimeEnabled()) {
      const instance = await instanceService.findStatusBySlug(slug)
      if (!instance || instance.status !== 'running') {
        return null
      }

      const connection = getE2eRuntimeConnection()
      return connection
        ? { baseUrl: connection.baseUrl, authHeader: connection.authHeader }
        : null
    }

    return createWorkspaceAgentClient(slug)
  },
}
