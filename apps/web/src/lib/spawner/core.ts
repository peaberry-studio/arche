import { auditService, instanceService, providerService } from '@/lib/services'
import { getInstanceUrl, isInstanceHealthyWithPassword, type InstanceHealthResult } from '@/lib/opencode/client'
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

type ContainerNetworkInspect = {
  NetworkSettings?: {
    IPAddress?: string
    Networks?: Record<string, { IPAddress?: string }>
  }
}

type StartupHealthResult = InstanceHealthResult & { baseUrl?: string }

function getErrorDetail(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const error = err as {
    json?: { message?: string }
    message?: string
    reason?: string
  }

  return error.json?.message ?? error.message ?? error.reason
}

function isStartingStillFresh(instance: { status: string; startedAt: Date | null }): boolean {
  if (instance.status !== 'starting' || !instance.startedAt) return false

  return Date.now() - instance.startedAt.getTime() <= getStartTimeoutMs() * 2
}

export async function startInstance(slug: string, userId: string): Promise<StartResult> {
  const existing = await instanceService.findBySlug(slug)

  if (existing?.status === 'running' || (existing && isStartingStillFresh(existing))) {
    return { ok: false, error: 'already_running' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)

  if (existing?.containerId) {
    await docker.removeContainer(existing.containerId).catch(() => {})
  }
  await docker.removeManagedContainerForSlug(slug)

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

    if (!healthy.ok) {
      const timeoutDetail = healthy.message
        ? `healthcheck timeout: ${healthy.detail}: ${healthy.message}`
        : `healthcheck timeout: ${healthy.detail}`
      console.warn('[spawner] OpenCode healthcheck timed out', {
        containerId: container.id,
        detail: healthy.detail,
        message: healthy.message,
        slug,
      })
      await docker.stopContainer(container.id).catch(() => {})
      await docker.removeContainer(container.id).catch(() => {})
      containerId = null
      await instanceService.setError(slug)
      return { ok: false, error: 'timeout', detail: timeoutDetail }
    }

    // Sync providers and clear OpenCode's discovery cache BEFORE marking as
    // 'running'. The DB status gates all frontend connections, so providers
    // must be ready before it flips.
    const syncUserId = owner?.id ?? userId
    const syncResult = await syncProviderAccessForInstance({
      instance: {
        baseUrl: healthy.baseUrl ?? getInstanceUrl(slug),
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
      const health = await isInstanceHealthyWithPassword(slug, password)

      if (health.ok) {
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

function getContainerIpAddress(info: ContainerNetworkInspect): string | null {
  const directIp = info.NetworkSettings?.IPAddress
  if (directIp) {
    return directIp
  }

  const networks = info.NetworkSettings?.Networks
  if (!networks) {
    return null
  }

  for (const network of Object.values(networks)) {
    if (network.IPAddress) {
      return network.IPAddress
    }
  }

  return null
}

async function getContainerHealthBaseUrl(containerId: string): Promise<string | null> {
  try {
    const info: ContainerNetworkInspect = await docker.inspectContainer(containerId)
    const ipAddress = getContainerIpAddress(info)
    return ipAddress ? `http://${ipAddress}:4096` : null
  } catch (error) {
    console.warn('[spawner] Failed to inspect container IP for healthcheck', {
      containerId,
      error: error instanceof Error ? error.message : error,
    })
    return null
  }
}

async function waitForHealthy(containerId: string, slug: string, password: string): Promise<StartupHealthResult> {
  const timeout = getStartTimeoutMs()
  const start = Date.now()
  let directBaseUrl: string | null | undefined
  let directHealthy = false
  let lastHealth: InstanceHealthResult = { ok: false, detail: 'container_not_running' }

  while (Date.now() - start < timeout) {
    // First check if container is running
    const running = await docker.isContainerRunning(containerId)
    if (!running) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    if (directBaseUrl === undefined) {
      directBaseUrl = await getContainerHealthBaseUrl(containerId)
      if (directBaseUrl) {
        console.log('[spawner] Using direct container IP for initial healthcheck', {
          baseUrl: directBaseUrl,
          containerId,
          slug,
        })
      }
    }

    if (directBaseUrl && !directHealthy) {
      const directHealth = await isInstanceHealthyWithPassword(slug, password, directBaseUrl)
      if (directHealth.ok) {
        directHealthy = true
        console.log('[spawner] OpenCode responded on direct container IP', { containerId, slug })
      } else {
        lastHealth = directHealth
      }
    }

    // Then verify OpenCode is actually responding
    const health = await isInstanceHealthyWithPassword(slug, password)
    if (health.ok) return health
    lastHealth = health

    if (directHealthy) {
      console.warn('[spawner] DNS healthcheck unavailable after direct IP success; continuing startup', {
        containerId,
        detail: health.detail,
        directBaseUrl,
        message: health.message,
        slug,
      })
      return { ok: true, baseUrl: directBaseUrl ?? undefined }
    }

    await new Promise(r => setTimeout(r, 1000))
  }

  if (directHealthy) {
    console.warn('[spawner] DNS healthcheck timed out after direct IP success; continuing startup', {
      containerId,
      directBaseUrl,
      slug,
    })
    return { ok: true, baseUrl: directBaseUrl ?? undefined }
  }

  return lastHealth.ok ? { ok: false, detail: 'healthcheck timeout' } : lastHealth
}
