import crypto from 'node:crypto'

import {
  createConnectionClient,
  getInstanceBasicAuth,
  normalizeOpenCodeError,
  type OpenCodeV2Client,
} from '@/lib/harness/adapters/opencode-v2/client'
import type { HarnessProviderAccessInput } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { withRuntimeOperationLock } from '@/lib/harness/operation-lock'
import { getCanonicalProviderId, toRuntimeProviderId } from '@/lib/providers/catalog'
import { getGatewayTokenTtlSeconds } from '@/lib/providers/config'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS } from '@/lib/providers/types'
import { getRuntimeOpencodeConsoleUrl } from '@/lib/runtime/internal-api'
import { auditService, instanceService, messageRunService } from '@/lib/services'

type Connection = { baseUrl: string; authHeader: string }

// Every credential Arche creates carries this label so it can be told apart
// from entries a user or another integration added to the store.
export const ARCHE_CREDENTIAL_LABEL_PREFIX = 'arche-managed:'

// Refresh slightly before the gateway token expires so long-running runs do not
// reuse credentials that are about to age out.
const PROVIDER_SYNC_REFRESH_SKEW_MS = 60_000
const RELOAD_TIMEOUT_MS = 30_000
const RECOVERY_TIMEOUT_MS = 30_000
const RECOVERY_POLL_INTERVAL_MS = 1_000
const RECOVERY_PROBE_TIMEOUT_MS = 3_000
// A waiting sync outlasts one full replacement, reload and recovery.
const PROVIDER_SYNC_LOCK_WAIT_MS = 65_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildProviderSyncHash(enabledByProvider: EnabledProviderCredentials): string {
  const payload = Array.from(enabledByProvider.entries())
    .map(([providerId, value]) => ({
      credentialId: value.credentialId,
      providerId,
      source: value.source,
      version: value.version,
    }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId))

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function shouldRefreshProviderAccess(args: {
  expectedHash: string
  providerSyncHash: string | null
  providerSyncedAt: Date | null
}): boolean {
  if (args.providerSyncHash !== args.expectedHash || !args.providerSyncedAt) return true
  const refreshAgeMs = Math.max(0, getGatewayTokenTtlSeconds() * 1000 - PROVIDER_SYNC_REFRESH_SKEW_MS)
  return Date.now() - args.providerSyncedAt.getTime() >= refreshAgeMs
}

// Entries for any provider Arche manages are purged even without the label:
// leaving one would let the runtime fall back to it once Arche's entry is gone.
// Unlabelled entries for other integrations are never touched.
function isManagedCredential(entry: { integrationID: string; label: string }): boolean {
  return entry.label.startsWith(ARCHE_CREDENTIAL_LABEL_PREFIX) || getCanonicalProviderId(entry.integrationID) !== null
}

function buildDesiredCredentials(input: {
  enabledByProvider: EnabledProviderCredentials
  slug: string
  userId: string
}): Map<string, string> {
  const desired = new Map<string, string>()
  for (const providerId of PROVIDERS) {
    const enabled = input.enabledByProvider.get(providerId)
    if (enabled) {
      desired.set(toRuntimeProviderId(providerId), issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId,
        version: enabled.version,
        credentialId: enabled.credentialId,
        credentialSource: enabled.source,
      }))
    } else if (providerId === 'opencode') {
      desired.set(toRuntimeProviderId(providerId), issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId: 'opencode',
        version: 0,
      }))
    }
  }
  return desired
}

// Credentials take effect without a reload, so replacements are installed
// before anything is removed: a new active entry deactivates its predecessor,
// and no in-flight request sees an empty slot. Stale entries are then removed
// inactive-first, so removing an active entry can never reactivate an older one.
async function replaceManagedCredentials(client: OpenCodeV2Client, desired: Map<string, string>, input: { slug: string; userId: string; signal: AbortSignal }): Promise<void> {
  const installed = new Set<string>()
  for (const [integrationID, key] of desired) {
    input.signal.throwIfAborted()
    const entry = await client.credential.create({
      integrationID,
      label: `${ARCHE_CREDENTIAL_LABEL_PREFIX}${integrationID}`,
      // OpenCode 2 treats an `opencode` key as an OpenCode Console account and
      // polls the Console with it; point that at Arche so the gateway token stays here.
      value: { type: 'key', key, ...(integrationID === 'opencode' && { metadata: { server: getRuntimeOpencodeConsoleUrl() } }) },
      activate: true,
    }, { signal: input.signal })
    installed.add(entry.id)
  }

  input.signal.throwIfAborted()
  const stale = (await client.credential.list({ signal: input.signal }))
    .filter((entry) => isManagedCredential(entry) && !installed.has(entry.id))
    .sort((left, right) => Number(left.active) - Number(right.active))
  for (const entry of stale) {
    input.signal.throwIfAborted()
    await client.credential.remove({ credentialID: entry.id }, { signal: input.signal })
    if (!entry.label.startsWith(ARCHE_CREDENTIAL_LABEL_PREFIX)) {
      await auditService.createEvent({
        actorUserId: input.userId,
        action: 'provider.unlabelled_credential_purged',
        metadata: { slug: input.slug, credentialId: entry.id, integrationId: entry.integrationID },
      })
    }
  }

  input.signal.throwIfAborted()
  const remaining = (await client.credential.list({ signal: input.signal })).filter(isManagedCredential)
  const consistent = remaining.length === installed.size &&
    remaining.every((entry) => installed.has(entry.id) && entry.active && desired.has(entry.integrationID))
  if (!consistent) throw new Error('v2_managed_credential_state_unconfirmed')
}

async function waitForRecoveryAfterReload(client: OpenCodeV2Client, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    try {
      const info = await client.server.info({ signal: AbortSignal.any([signal, AbortSignal.timeout(RECOVERY_PROBE_TIMEOUT_MS)]) })
      if (info.version.startsWith('2.')) {
        signal.throwIfAborted()
        await client.model.list(undefined, { signal: AbortSignal.any([signal, AbortSignal.timeout(RECOVERY_PROBE_TIMEOUT_MS)]) })
        return true
      }
    } catch {
      // The location is rebuilding; retry until the deadline.
    }
    await sleep(RECOVERY_POLL_INTERVAL_MS)
  }
  return false
}

async function syncProviderAccessForInstance(input: {
  connection: Connection
  slug: string
  userId: string
  reload: boolean
  signal: AbortSignal
}): Promise<HarnessResult<void>> {
  try {
    const enabledByProvider = await getEnabledProviderCredentialsForUser(input.userId)
    const providerSyncHash = buildProviderSyncHash(enabledByProvider)
    const client = createConnectionClient(input.connection)

    await replaceManagedCredentials(client, buildDesiredCredentials({ enabledByProvider, slug: input.slug, userId: input.userId }), input)

    if (input.reload) {
      // Reload rebuilds provider discovery and cancels pending permissions, so
      // it never runs underneath an active run. Freshness stays unrecorded and
      // a later sync reloads once the workspace is idle.
      if (await messageRunService.hasActiveRunForSlug(input.slug)) {
        console.warn('[opencode-v2/providers] Deferred location reload because a run is active', { slug: input.slug })
        return { ok: true, data: undefined }
      }

      input.signal.throwIfAborted()
      await client.location.reload({ signal: AbortSignal.any([input.signal, AbortSignal.timeout(RELOAD_TIMEOUT_MS)]) })
      if (!(await waitForRecoveryAfterReload(client, input.signal))) {
        console.warn('[opencode-v2/providers] Location did not recover after reload', { slug: input.slug })
        return harnessFailure('sync_failed', 'v2_reload_recovery_unconfirmed')
      }
    }

    input.signal.throwIfAborted()
    try {
      await instanceService.setProviderSyncState(input.slug, providerSyncHash, new Date())
    } catch (error) {
      console.error('[opencode-v2/providers] Failed to persist provider sync state', error)
    }

    return { ok: true, data: undefined }
  } catch (error) {
    // Only the normalized code is logged: request errors may echo credential payloads.
    const code = error instanceof Error && error.message.startsWith('v2_') ? error.message : normalizeOpenCodeError(error).error.code
    console.error('[opencode-v2/providers] Failed to sync providers', { slug: input.slug, code })
    return harnessFailure('sync_failed', code)
  }
}

async function isProviderAccessFresh(slug: string, input: HarnessProviderAccessInput): Promise<boolean> {
  if (input.force) return false
  const expectedHash = buildProviderSyncHash(await getEnabledProviderCredentialsForUser(input.userId))
  const current = await instanceService.findProviderSyncBySlug(slug)
  return current?.status === 'running' &&
    !shouldRefreshProviderAccess({ expectedHash, providerSyncHash: current.providerSyncHash, providerSyncedAt: current.providerSyncedAt })
}

async function ensureProviderAccessFreshForExecution(slug: string, input: HarnessProviderAccessInput, signal: AbortSignal): Promise<HarnessResult<void>> {
  try {
    // Re-checked under the lock: the previous holder may have just refreshed.
    if (await isProviderAccessFresh(slug, input)) return { ok: true, data: undefined }

    if (await messageRunService.hasActiveRunForSlug(slug, { ignoreRunId: input.ignoreActiveRunId })) {
      console.warn('[opencode-v2/providers] Deferred provider sync while workspace runs are active', { slug })
      return { ok: true, data: undefined }
    }

    const connection = await getInstanceBasicAuth(slug)
    if (!connection) return harnessFailure('instance_unavailable')
    return syncProviderAccessForInstance({ connection, slug, userId: input.userId, reload: true, signal })
  } catch (error) {
    return harnessFailure('sync_failed', error instanceof Error ? error.message : undefined)
  }
}

export async function syncProviderAccess(slug: string, input: HarnessProviderAccessInput): Promise<HarnessResult<void>> {
  const executionCheck = !input.connection && input.disposeInstance === undefined
  try {
    // Most execution checks find access fresh; they need no lock connection.
    if (executionCheck && await isProviderAccessFresh(slug, input)) return { ok: true, data: undefined }
  } catch {
    // The locked path below reports the failure.
  }
  try {
    const result = await withRuntimeOperationLock(JSON.stringify(['harness-provider-sync', slug]), async (signal) => {
      if (executionCheck) return ensureProviderAccessFreshForExecution(slug, input, signal)
      let connection: Connection | null
      try {
        connection = input.connection ?? await getInstanceBasicAuth(slug)
      } catch {
        return harnessFailure('instance_unavailable')
      }
      if (!connection) return harnessFailure('instance_unavailable')
      return syncProviderAccessForInstance({ connection, slug, userId: input.userId, reload: input.disposeInstance !== false, signal })
    }, { waitMs: PROVIDER_SYNC_LOCK_WAIT_MS })
    // Provider sync never reports a busy session itself: busy is the lock timing out.
    if (!result.ok && result.error.code === 'session_busy') {
      return harnessFailure('sync_failed', result.error.detail === 'runtime_lock_capacity' ? 'v2_provider_sync_lock_capacity' : 'v2_provider_sync_lock_busy')
    }
    return result
  } catch {
    return harnessFailure('sync_failed', 'v2_provider_sync_lock_failed')
  }
}
