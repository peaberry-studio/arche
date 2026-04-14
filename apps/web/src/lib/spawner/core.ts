import { auditService, instanceService, providerService } from '@/lib/services'
import { getInstanceUrl, isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import * as docker from './docker'
import { decryptPassword, generatePassword, encryptPassword } from './crypto'
import { getStartExpectedMs, getStartTimeoutMs } from './config'
import {
  buildWorkspaceRuntimeArtifacts,
  getWebProviderGatewayConfig,
  hashWorkspaceRuntimeArtifacts,
} from './runtime-artifacts'

export type StartResult =
  | { ok: true; status: 'running' }
  | { ok: false; error: 'already_running' | 'start_failed' | 'timeout'; detail?: string }

export type StopResult =
  | { ok: true; status: 'stopped' }
  | { ok: false; error: 'not_running' | 'stop_failed' }

function getErrorDetail(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const error = err as {
    json?: { message?: string }
    message?: string
    reason?: string
  }

  return error.json?.message ?? error.message ?? error.reason
}

export async function startInstance(slug: string, userId: string): Promise<StartResult> {
  const existing = await instanceService.findBySlug(slug)

  if (existing?.status === 'running') {
    return { ok: false, error: 'already_running' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)

  await instanceService.upsertStarting(slug, encryptedPassword)

  let containerId: string | null = null

  try {
    const artifacts = await buildWorkspaceRuntimeArtifacts(slug, getWebProviderGatewayConfig())
    const appliedConfigSha = hashWorkspaceRuntimeArtifacts(artifacts)
    const { owner, opencodeConfigContent, agentsMd, skills } = artifacts

    const container = await docker.createContainer(slug, password, opencodeConfigContent, agentsMd, skills, {
      name: owner?.slug ?? slug,
      email: owner?.email ?? undefined,
    })
    containerId = container.id
    await docker.startContainer(container.id)

    await instanceService.setContainerId(slug, container.id)

    const healthy = await waitForHealthy(container.id, slug, password)

    if (!healthy) {
      await docker.stopContainer(container.id).catch(() => {})
      await docker.removeContainer(container.id).catch(() => {})
      containerId = null
      await instanceService.setError(slug)
      return { ok: false, error: 'timeout', detail: 'healthcheck timeout' }
    }

    // Sync providers and clear OpenCode's discovery cache BEFORE marking as
    // 'running'. The DB status gates all frontend connections, so providers
    // must be ready before it flips.
    const syncUserId = owner?.id ?? userId
    const syncResult = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      slug,
      userId: syncUserId,
    })
    if (!syncResult.ok) {
      await providerService.markWorkspaceRestartRequired(syncUserId)
      console.error('[spawner] Failed to sync OpenCode providers', syncResult.error)
    } else {
      await providerService.clearWorkspaceRestartRequired(syncUserId)
    }

    await instanceService.setRunning(slug, appliedConfigSha)

    await auditService.createEvent({
      actorUserId: userId,
      action: 'instance.started',
      metadata: { slug },
    })

    return { ok: true, status: 'running' }
  } catch (err) {
    const detail = getErrorDetail(err)
    if (detail) {
      console.error('[spawner] startInstance failed:', detail)
    } else {
      console.error('[spawner] startInstance failed: unknown error')
    }

    // Clean up container if it was created to avoid orphans and name conflicts
    if (containerId) {
      await docker.stopContainer(containerId).catch(() => {})
      await docker.removeContainer(containerId).catch(() => {})
    }

    await instanceService.setError(slug).catch(() => {})

    return { ok: false, error: 'start_failed', detail }
  }
}

export async function stopInstance(slug: string, userId: string): Promise<StopResult> {
  const instance = await instanceService.findBySlug(slug)

  if (!instance || instance.status === 'stopped') {
    return { ok: false, error: 'not_running' }
  }

  try {
    if (instance.containerId) {
      await docker.stopContainer(instance.containerId).catch(() => {})
      await docker.removeContainer(instance.containerId).catch(() => {})
    }

    await instanceService.setStopped(slug)

    await auditService.createEvent({
      actorUserId: userId,
      action: 'instance.stopped',
      metadata: { slug },
    })

    return { ok: true, status: 'stopped' }
  } catch {
    return { ok: false, error: 'stop_failed' }
  }
}

export async function getInstanceStatus(slug: string) {
  const instance = await instanceService.findStatusBySlug(slug)

  if (!instance) return null

  // If the DB says running/starting but there is no containerId, it is out of sync
  if ((instance.status === 'running' || instance.status === 'starting') && !instance.containerId) {
    await instanceService.setStoppedNoContainer(slug)
    return { ...instance, status: 'stopped' as const, containerId: null }
  }

  // If there is a containerId, verify the container actually exists and is running
  if (instance.containerId && (instance.status === 'running' || instance.status === 'starting')) {
    const isRunning = await docker.isContainerRunning(instance.containerId)

    if (!isRunning) {
      // Container does not exist or is not running - sync DB
      // Try to remove the container if it still exists
      await docker.removeContainer(instance.containerId).catch(() => {})

      await instanceService.setStopped(slug)
      return { ...instance, status: 'stopped' as const, containerId: null }
    }

    // Verify OpenCode is actually responding
    try {
      const password = decryptPassword(instance.serverPassword)
      const isHealthy = await isInstanceHealthyWithPassword(slug, password)

      if (isHealthy) {
        if (instance.status !== 'running') {
          await instanceService.correctToRunning(slug)
        }
        return { ...instance, status: 'running' as const }
      }

      if (instance.status === 'running') {
        // Container is running but OpenCode is not responding - mark as starting
        // so the frontend waits and retries
        return { ...instance, status: 'starting' as const }
      }
    } catch (err) {
      console.error('[spawner] Failed to decrypt instance password', err)
    }
  }

  return instance
}

export async function listActiveInstances() {
  return instanceService.findActiveInstances()
}

export function isSlowStart(instance: { status: string; startedAt: Date | null } | null): boolean {
  if (!instance || instance.status !== 'starting' || !instance.startedAt) {
    return false
  }
  const elapsed = Date.now() - instance.startedAt.getTime()
  return elapsed > getStartExpectedMs()
}

async function waitForHealthy(containerId: string, slug: string, password: string): Promise<boolean> {
  const timeout = getStartTimeoutMs()
  const start = Date.now()

  while (Date.now() - start < timeout) {
    // First check if container is running
    const running = await docker.isContainerRunning(containerId)
    if (!running) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    // Then verify OpenCode is actually responding
    const healthy = await isInstanceHealthyWithPassword(slug, password)
    if (healthy) return true

    await new Promise(r => setTimeout(r, 1000))
  }

  return false
}
