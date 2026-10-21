import type { HarnessHealthOptions, HarnessRuntime } from '@/lib/harness/contract'
import { abortSessionFamilyAndConfirmIdle } from '@/lib/harness/execution'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import {
  checkRuntimeHealth,
  CURRENT_RUNTIME_KIND,
  DEFAULT_HEALTH_TIMEOUT_MS,
  getLegacySessionReader,
  getRuntime,
  getRuntimeBaseUrl,
  isCurrentRuntimeKind,
  syncRuntimeProviderAccess,
} from '@/lib/harness/registry'
import { auditService, instanceService, providerService, userService } from '@/lib/services'
import type { InstanceRecord, InstanceStatusDetails } from '@/lib/services/instance'
import { settleRuntimeMigratedRuns } from '@/lib/services/runtime-migration'
import { getStartExpectedMs, getStartTimeoutMs } from '@/lib/spawner/config'
import { decryptPassword, encryptPassword, generatePassword } from '@/lib/spawner/crypto'
import * as docker from '@/lib/spawner/docker'
import { withHistoryMigrationProgress } from '@/lib/spawner/legacy-archive'
import {
  buildWorkspaceRuntimeArtifacts,
  getWebProviderGatewayConfig,
  hashWorkspaceRuntimeArtifacts,
} from '@/lib/spawner/runtime-artifacts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type StartResult =
  | { ok: true; status: 'running' }
  | { ok: false; error: 'already_running' | 'runtime_unsupported' | 'runtime_upgrade_pending' | 'start_failed' | 'timeout'; detail?: string }

export type StopResult =
  | { ok: true; status: 'stopped' }
  | { ok: false; error: 'not_running' | 'stop_failed' }

type ContainerNetworkInspect = {
  NetworkSettings?: {
    IPAddress?: string
    Networks?: Record<string, { IPAddress?: string }>
  }
}

type InstanceHealthResult = { ok: true } | { ok: false; detail: string; message?: string }
type StartupHealthResult = InstanceHealthResult & { baseUrl?: string }

async function checkInstanceHealth(
  slug: string,
  password: string,
  baseUrl?: string,
  options?: HarnessHealthOptions,
  runtime?: Pick<HarnessRuntime, 'health'>,
): Promise<InstanceHealthResult> {
  const healthOptions = { ...options, password, baseUrl }
  const result = await (runtime ? runtime.health(healthOptions) : checkRuntimeHealth(slug, healthOptions))
  return result.ok ? { ok: true } : {
    ok: false,
    detail: result.error.code,
    message: result.error.detail,
  }
}

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

export async function startInstance(
  slug: string,
  userId: string,
): Promise<StartResult> {
  const existing = await instanceService.findBySlug(slug)

  if ((existing?.status === 'running' && isCurrentRuntimeKind(existing.runtimeKind)) || (existing && isStartingStillFresh(existing))) {
    return { ok: false, error: 'already_running' }
  }

  try {
    if (await docker.hasLegacyBackendWriters()) return { ok: false, error: 'runtime_upgrade_pending' }
  } catch (error) {
    console.error('[spawner] Could not verify backend runtime contracts; refusing to start', { slug, error })
    return { ok: false, error: 'start_failed', detail: 'runtime_upgrade_check_failed' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)
  let ownedStartedAt = new Date()
  let legacySourceContainerId: string | null = null
  if (existing) {
    const claimed = await instanceService.claimStartingTransition(existing, ownedStartedAt)
    if (claimed.count === 0) return { ok: false, error: 'already_running' }
  }

  // A workspace last run on OpenCode 1 archives its conversations first. A
  // failed export fails this start and is retried on the next one; the legacy
  // volumes are never touched.
  if (existing && !isCurrentRuntimeKind(existing.runtimeKind)) {
    try {
      const archive = await withHistoryMigrationProgress(slug, () => archiveBeforeRuntimeSwitch(slug, existing))
      if (!archive.archived) {
        console.warn('[spawner] Legacy archive failed; retrying on the next start', { slug })
        await instanceService.failStartingTransition(existing.id, ownedStartedAt)
        return { ok: false, error: 'start_failed', detail: 'legacy_archive_failed' }
      }
      const continuedAt = new Date()
      const continued = await instanceService.continueStartingTransition(existing, ownedStartedAt, existing.serverPassword, continuedAt)
      if (continued.count === 0) return { ok: false, error: 'already_running' }
      ownedStartedAt = continuedAt
      legacySourceContainerId = archive.sourceContainerId
      await settleRuntimeMigratedRuns(slug)
    } catch (error) {
      console.error('[spawner] Legacy archive preparation failed; preserving legacy state', { slug, error })
      await instanceService.failStartingTransition(existing.id, ownedStartedAt)
      return { ok: false, error: 'start_failed', detail: 'legacy_archive_preparation_failed' }
    }
  } else if (existing) {
    const continuedAt = new Date()
    const continued = await instanceService.continueStartingTransition(existing, ownedStartedAt, encryptedPassword, continuedAt)
    if (continued.count === 0) return { ok: false, error: 'already_running' }
    ownedStartedAt = continuedAt
  }
  const runtime = getRuntime(slug)

  try {
    await docker.removeManagedArchiveContainerForSlug(slug)
    if (legacySourceContainerId) await docker.removeContainer(legacySourceContainerId)
    if (existing?.containerId) {
      await docker.removeContainer(existing.containerId).catch(() => {})
    }
    await docker.removeManagedContainerForSlug(slug)
    if (!existing) await instanceService.upsertStarting(slug, encryptedPassword)
    if (existing && !isCurrentRuntimeKind(existing.runtimeKind)) {
      const rotated = await instanceService.setStartingPassword(slug, ownedStartedAt, encryptedPassword)
      if (rotated.count === 0) return { ok: false, error: 'already_running' }
    }
  } catch {
    if (existing) await instanceService.failStartingTransition(existing.id, ownedStartedAt)
    return { ok: false, error: 'start_failed', detail: 'legacy_archive_cleanup_failed' }
  }

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

    await instanceService.setContainerId(slug, container.id, CURRENT_RUNTIME_KIND)

    const healthy = await waitForHealthy(container.id, slug, password, runtime)

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
    const syncResult = await runtime.syncProviderAccess({
      connection: {
        baseUrl: healthy.baseUrl ?? getRuntimeBaseUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      userId: syncUserId,
    })
    if (!syncResult.ok) {
      await providerService.markWorkspaceRestartRequired(syncUserId)
      console.error('[spawner] Failed to sync OpenCode providers', syncResult.error)
      await handleFailedAttempt(slug, container.id)
      return { ok: false, error: 'start_failed', detail: syncResult.error.code }
    } else {
      await providerService.clearWorkspaceRestartRequired(syncUserId)
    }

    // Publish 'running' only if this attempt still owns the transition. If it
    // lost the race, re-read and return the current state without a duplicate
    // audit event.
    const affected = await instanceService.setRunningIfCurrentContainer(slug, container.id, appliedConfigSha, CURRENT_RUNTIME_KIND)
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
      metadata: { slug, runtimeKind: CURRENT_RUNTIME_KIND },
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

async function archiveBeforeRuntimeSwitch(slug: string, existing: InstanceRecord): Promise<{ archived: boolean; sourceContainerId: string | null }> {
  await docker.removeManagedArchiveContainerForSlug(slug)
  await docker.removeOrphanedV2ContainerForSlug(slug)
  const sourceContainer = await docker.findLegacyArchiveSource(slug, existing.containerId)
  if (sourceContainer && !sourceContainer.running) await docker.removeContainer(sourceContainer.id)
  const runningSource = sourceContainer?.running ? sourceContainer : null
  const password = runningSource ? decryptPassword(existing.serverPassword) : generatePassword()
  let archiveContainerId: string | null = null
  let baseUrl = runningSource ? `http://${runningSource.name}:4096` : getRuntimeBaseUrl(slug)
  if (!runningSource) {
    const container = await docker.createArchiveContainer(slug, password)
    archiveContainerId = container.id
    baseUrl = `http://${container.name}:4096`
  }
  const result = (archived: boolean) => ({ archived, sourceContainerId: runningSource?.id ?? null })
  try {
    if (archiveContainerId) await docker.startContainer(archiveContainerId)
    const connection = {
      baseUrl,
      authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      signal: AbortSignal.timeout(getStartTimeoutMs()),
    }
    if (archiveContainerId) {
      const health = await waitForHealthy(archiveContainerId, slug, password, getLegacySessionReader(slug, connection))
      if (!health.ok) return result(false)
      if (health.baseUrl) connection.baseUrl = health.baseUrl
    }
    const source = getLegacySessionReader(slug, connection)
    const statuses = await source.sessionStatus({ signal: connection.signal })
    if (!statuses.ok) return result(false)
    for (const [sessionId, status] of Object.entries(statuses.data)) {
      if (status.type !== 'idle' && !await abortSessionFamilyAndConfirmIdle({ client: source, rootSessionId: sessionId })) {
        return result(false)
      }
    }
    const exported = await exportLegacySessions(slug, source)
    if (!exported.ok) {
      console.error('[spawner] Legacy session export failed', { slug, error: exported.error.code })
      return result(false)
    }
    console.info('[spawner] Archived legacy session history', { slug, archived: exported.data.archived })
    return result(true)
  } catch (error) {
    console.error('[spawner] Legacy session export failed', { slug, error })
    return result(false)
  } finally {
    if (archiveContainerId) {
      // Never start a second process on the legacy volume unless removal is confirmed.
      await docker.removeContainer(archiveContainerId)
    }
  }
}

export async function stopInstance(slug: string, userId: string): Promise<StopResult> {
  const instance = await instanceService.findBySlug(slug)

  if (!instance || instance.status === 'stopped') {
    return { ok: false, error: 'not_running' }
  }
  if (instance.status === 'starting') return { ok: false, error: 'stop_failed' }

  const startedAt = new Date()
  let ownsTransition = false
  try {
    const claimed = await instanceService.claimStartingTransition(instance, startedAt)
    if (claimed.count === 0) return { ok: false, error: 'stop_failed' }
    ownsTransition = true
    if (instance.containerId) {
      let stopConfirmed = false
      try {
        await docker.stopContainer(instance.containerId)
        stopConfirmed = true
      } catch {
        // Force removal can still confirm termination if graceful stop failed.
      }
      try {
        await docker.removeContainer(instance.containerId)
      } catch (error) {
        if (!stopConfirmed) throw error
      }
    }

    const stopped = await instanceService.finishStoppingTransition(instance.id, startedAt)
    if (stopped.count === 0) return { ok: false, error: 'stop_failed' }

    await auditService.createEvent({
      actorUserId: userId,
      action: 'instance.stopped',
      metadata: { slug },
    })

    return { ok: true, status: 'stopped' }
  } catch {
    if (ownsTransition) {
      await instanceService.recoverStoppingTransition(instance, startedAt).catch((error) => {
        console.error('[spawner] Failed to recover shutdown ownership', { slug, error })
      })
    }
    return { ok: false, error: 'stop_failed' }
  }
}

export async function getInstanceStatus(slug: string) {
  const instance = await instanceService.findStatusBySlug(slug)

  if (!instance) return null

  // A workspace still running on OpenCode 1 is not served. Reporting it stopped
  // makes the next start archive its history from the live container and migrate.
  if (instance.status === 'running' && !isCurrentRuntimeKind(instance.runtimeKind)) return { ...instance, status: 'stopped' as const }

  if (isStartingStillFresh(instance)) return instance

  // If the DB says running/starting but there is no containerId, it is out of sync
  if ((instance.status === 'running' || instance.status === 'starting') && !instance.containerId) {
    const stopped = await instanceService.setStoppedIfCurrentSnapshot(slug, instance)
    if (stopped.count === 0) return instanceService.findStatusBySlug(slug)
    return { ...instance, status: 'stopped' as const, containerId: null }
  }

  // If there is a containerId, verify the container actually exists and is running
  if (instance.containerId && (instance.status === 'running' || instance.status === 'starting')) {
    const isRunning = await docker.isContainerRunning(instance.containerId)

    if (!isRunning) {
      // Container does not exist or is not running - sync DB
      // Try to remove the container if it still exists
      await docker.removeContainer(instance.containerId).catch(() => {})

      const stopped = await instanceService.setStoppedIfCurrentSnapshot(slug, instance)
      if (stopped.count === 0) return instanceService.findStatusBySlug(slug)
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
      const health = await checkInstanceHealth(slug, password)

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
    const health = await checkInstanceHealth(slug, password)
    if (!health.ok) {
      return instance
    }

    const owner = await userService.findIdBySlug(slug)
    if (!owner?.id) {
      return instance
    }

    const syncResult = await syncRuntimeProviderAccess(slug, {
      connection: {
        baseUrl: getRuntimeBaseUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
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

async function waitForHealthy(containerId: string, slug: string, password: string, runtime: Pick<HarnessRuntime, 'health'>): Promise<StartupHealthResult> {
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
    const outcome = await probeDnsAndDirect(slug, password, directBaseUrl, probeTimeout, runtime)

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
  runtime: Pick<HarnessRuntime, 'health'>,
): Promise<ProbeOutcome> {
  const dnsController = new AbortController()
  const direct = directBaseUrl ? { controller: new AbortController() } : null
  const results: { dns?: InstanceHealthResult; direct?: InstanceHealthResult } = {}

  const runDns = async () => {
    const result = await checkInstanceHealth(slug, password, undefined, {
      timeoutMs,
      signal: dnsController.signal,
    }, runtime)
    results.dns = result
    if (result.ok) direct?.controller.abort()
  }

  const runDirect = direct
    ? async () => {
        const result = await checkInstanceHealth(slug, password, directBaseUrl!, {
          timeoutMs,
          signal: direct.controller.signal,
        }, runtime)
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
