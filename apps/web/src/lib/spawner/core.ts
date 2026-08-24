import { auditService, instanceService, providerService, userService } from '@/lib/services'
import type { InstanceStatusDetails } from '@/lib/services/instance'
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  getInstanceUrl,
  isInstanceHealthyWithPassword,
  type InstanceHealthResult,
} from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import * as docker from './docker'
import { decryptPassword, generatePassword, encryptPassword } from './crypto'
import { getStartExpectedMs, getStartTimeoutMs } from './config'
import {
  buildWorkspaceRuntimeArtifacts,
  getWebProviderGatewayConfig,
  hashWorkspaceRuntimeArtifacts,
} from './runtime-artifacts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

/**
 * Tear down a failed startup attempt without ever destroying a container that
 * this instance's current state still references.
 *
 * - Owns the transition (setErrorIfCurrentContainer matched the attempt):
 *   stop/remove the container.
 * - Lost the race but the DB still references the attempt's own containerId
 *   (another flow already confirmed this container): do nothing.
 * - The DB references a different containerId (superseded by a newer attempt):
 *   remove only the attempt's own orphaned container, never the current one.
 */
async function handleFailedAttempt(slug: string, containerId: string | null): Promise<void> {
  if (!containerId) {
    await instanceService.setError(slug).catch(() => {})
    return
  }

  const affected = await instanceService.setErrorIfCurrentContainer(slug, containerId)

  if (affected.count > 0) {
    await docker.stopContainer(containerId).catch(() => {})
    await docker.removeContainer(containerId).catch(() => {})
    return
  }

  const current = await instanceService.findContainerStatusBySlug(slug)
  if (current && current.containerId !== containerId) {
    await docker.stopContainer(containerId).catch(() => {})
    await docker.removeContainer(containerId).catch(() => {})
  }
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
      await handleFailedAttempt(slug, container.id)
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

    // Publish 'running' only if this attempt still owns the transition. If it
    // lost the race, re-read and return the current state without a duplicate
    // audit event.
    const affected = await instanceService.setRunningIfCurrentContainer(slug, container.id, appliedConfigSha)
    if (affected.count === 0) {
      const current = await instanceService.findStatusBySlug(slug)
      if (current && current.status === 'running') {
        return { ok: true, status: 'running' }
      }
      return { ok: false, error: 'start_failed', detail: 'startup superseded by another attempt' }
    }

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

    await handleFailedAttempt(slug, containerId)

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
      // A recent 'starting' attempt stays 'starting' even if the process answers
      // health; only the startup flow (or reconciliation of a stale attempt)
      // publishes 'running'.
      if (isStartingStillFresh(instance)) {
        return instance
      }

      if (instance.status === 'starting') {
        // Stale attempt: recover it through the reconciliation flow before
        // reporting as running.
        return await reconcileStartingInstance(slug, instance)
      }

      const password = decryptPassword(instance.serverPassword)
      const health = await isInstanceHealthyWithPassword(slug, password)

      if (health.ok) {
        return { ...instance, status: 'running' as const }
      }

      if (instance.status === 'running') {
        // Container is running but OpenCode is not responding - mark as starting
        // so the frontend waits and retries
        return { ...instance, status: 'starting' as const }
      }
    } catch (err) {
      console.error('[spawner] Failed to verify instance health', err)
    }
  }

  return instance
}

/**
 * Recover a 'starting' instance whose startup attempt was interrupted (no
 * longer fresh). Verifies health within the bounded deadline, syncs providers,
 * then publishes 'running' only if this attempt still owns the transition
 * (status 'starting' and containerId unchanged). If the attempt lost the race,
 * re-read and return the current state.
 */
async function reconcileStartingInstance(
  slug: string,
  instance: InstanceStatusDetails,
): Promise<InstanceStatusDetails> {
  if (!instance.containerId) return instance

  try {
    const password = decryptPassword(instance.serverPassword)
    const health = await isInstanceHealthyWithPassword(slug, password)
    if (!health.ok) {
      return instance
    }

    const owner = await userService.findIdBySlug(slug)
    if (!owner?.id) {
      return instance
    }

    const syncResult = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      slug,
      userId: owner.id,
    })
    if (!syncResult.ok) {
      return instance
    }

    const affected = await instanceService.correctToRunningIfCurrentContainer(slug, instance.containerId)
    if (affected.count > 0) {
      return { ...instance, status: 'running' as const }
    }

    return (await instanceService.findStatusBySlug(slug)) ?? instance
  } catch (err) {
    console.error('[spawner] Failed to reconcile starting instance', {
      slug,
      error: err instanceof Error ? err.message : err,
    })
    return instance
  }
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
  let lastHealth: InstanceHealthResult = { ok: false, detail: 'container_not_running' }

  while (Date.now() - start < timeout) {
    // First check if container is running
    const running = await docker.isContainerRunning(containerId)
    if (!running) {
      await sleep(1000)
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

    // Each probe is bounded by min(DEFAULT_HEALTH_TIMEOUT_MS, remaining budget)
    // so the total flow still honors ARCHE_START_TIMEOUT_MS.
    const remaining = timeout - (Date.now() - start)
    const probeTimeout = Math.max(1, Math.min(DEFAULT_HEALTH_TIMEOUT_MS, remaining))

    // Probe DNS hostname and the direct container IP concurrently so neither can
    // stall the other; whichever confirms health cancels the losing request.
    const outcome = await probeDnsAndDirect(slug, password, directBaseUrl, probeTimeout)

    if (outcome.winner === 'dns') {
      return { ok: true }
    }

    if (outcome.winner === 'direct') {
      console.log('[spawner] OpenCode responded on direct container IP', { containerId, slug })
      console.warn('[spawner] DNS healthcheck unavailable after direct IP success; continuing startup', {
        containerId,
        detail: outcome.dnsResult && !outcome.dnsResult.ok ? outcome.dnsResult.detail : undefined,
        directBaseUrl,
        message: outcome.dnsResult && !outcome.dnsResult.ok ? outcome.dnsResult.message : undefined,
        slug,
      })
      return { ok: true, baseUrl: directBaseUrl ?? undefined }
    }

    lastHealth = outcome.dnsResult ?? outcome.directResult ?? { ok: false, detail: 'healthcheck timeout' }
    await sleep(1000)
  }

  return lastHealth.ok ? { ok: false, detail: 'healthcheck timeout' } : lastHealth
}

type ProbeOutcome = {
  winner: 'dns' | 'direct' | null
  dnsResult?: InstanceHealthResult
  directResult?: InstanceHealthResult
}

/**
 * Run the DNS and (when available) direct-IP health probes concurrently, each
 * bounded to `timeoutMs`. As soon as one confirms health, the other probe's
 * request is aborted so a stuck connection cannot keep running. If neither
 * confirms, both settled results are returned for diagnostics.
 */
async function probeDnsAndDirect(
  slug: string,
  password: string,
  directBaseUrl: string | null,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const dnsController = new AbortController()
  const direct = directBaseUrl ? { controller: new AbortController() } : null
  const results: { dns?: InstanceHealthResult; direct?: InstanceHealthResult } = {}

  const runDns = async () => {
    const result = await isInstanceHealthyWithPassword(slug, password, undefined, {
      timeoutMs,
      signal: dnsController.signal,
    })
    results.dns = result
    if (result.ok) direct?.controller.abort()
  }

  const runDirect = direct
    ? async () => {
        const result = await isInstanceHealthyWithPassword(slug, password, directBaseUrl!, {
          timeoutMs,
          signal: direct.controller.signal,
        })
        results.direct = result
        if (result.ok) dnsController.abort()
      }
    : null

  if (direct) {
    await Promise.all([runDns(), runDirect!()])
  } else {
    await runDns()
  }

  if (results.dns?.ok) return { winner: 'dns', dnsResult: results.dns, directResult: results.direct }
  if (results.direct?.ok) return { winner: 'direct', dnsResult: results.dns, directResult: results.direct }
  return { winner: null, dnsResult: results.dns, directResult: results.direct }
}
