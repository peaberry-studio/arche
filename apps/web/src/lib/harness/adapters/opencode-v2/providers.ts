import crypto from 'node:crypto'

import {
  createConnectionClient,
  getInstanceBasicAuth,
  normalizeOpenCodeError,
  type OpenCodeV2Client,
} from '@/lib/harness/adapters/opencode-v2/client'
import type { HarnessProviderAccessInput } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { getCanonicalProviderId, toRuntimeProviderId } from '@/lib/providers/catalog'
import { getGatewayTokenTtlSeconds } from '@/lib/providers/config'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS } from '@/lib/providers/types'
import { instanceService, messageRunService } from '@/lib/services'

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
const providerSyncLocks = new Map<string, Promise<void>>()

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

async function withProviderSyncLock<T>(slug: string, work: () => Promise<T>): Promise<T> {
  const previous = providerSyncLocks.get(slug) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })

  providerSyncLocks.set(slug, current)
  await previous.catch(() => undefined)

  try {
    return await work()
  } finally {
    releaseCurrent()
    if (providerSyncLocks.get(slug) === current) providerSyncLocks.delete(slug)
  }
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
async function replaceManagedCredentials(client: OpenCodeV2Client, desired: Map<string, string>): Promise<void> {
  const installed = new Set<string>()
  for (const [integrationID, key] of desired) {
    const entry = await client.credential.create({
      integrationID,
      label: `${ARCHE_CREDENTIAL_LABEL_PREFIX}${integrationID}`,
      value: { type: 'key', key },
      activate: true,
    })
    installed.add(entry.id)
  }

  const stale = (await client.credential.list())
    .filter((entry) => isManagedCredential(entry) && !installed.has(entry.id))
    .sort((left, right) => Number(left.active) - Number(right.active))
  for (const entry of stale) await client.credential.remove({ credentialID: entry.id })

  const remaining = (await client.credential.list()).filter(isManagedCredential)
  const consistent = remaining.length === installed.size &&
    remaining.every((entry) => installed.has(entry.id) && entry.active && desired.has(entry.integrationID))
  if (!consistent) throw new Error('v2_managed_credential_state_unconfirmed')
}

async function waitForRecoveryAfterReload(client: OpenCodeV2Client): Promise<boolean> {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const info = await client.server.info({ signal: AbortSignal.timeout(RECOVERY_PROBE_TIMEOUT_MS) })
      if (info.version.startsWith('2.')) {
        await client.model.list(undefined, { signal: AbortSignal.timeout(RECOVERY_PROBE_TIMEOUT_MS) })
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
}): Promise<HarnessResult<void>> {
  try {
    const enabledByProvider = await getEnabledProviderCredentialsForUser(input.userId)
    const providerSyncHash = buildProviderSyncHash(enabledByProvider)
    const client = createConnectionClient(input.connection)

    await replaceManagedCredentials(client, buildDesiredCredentials({ enabledByProvider, slug: input.slug, userId: input.userId }))

    if (input.reload) {
      // Reload rebuilds provider discovery and cancels pending permissions, so
      // it never runs underneath an active run. Freshness stays unrecorded and
      // a later sync reloads once the workspace is idle.
      if (await messageRunService.hasActiveRunForSlug(input.slug)) {
        console.warn('[opencode-v2/providers] Deferred location reload because a run is active', { slug: input.slug })
        return { ok: true, data: undefined }
      }

      await client.location.reload({ signal: AbortSignal.timeout(RELOAD_TIMEOUT_MS) })
      if (!(await waitForRecoveryAfterReload(client))) {
        console.warn('[opencode-v2/providers] Location did not recover after reload', { slug: input.slug })
        return harnessFailure('sync_failed', 'v2_reload_recovery_unconfirmed')
      }
    }

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

async function ensureProviderAccessFreshForExecution(slug: string, input: HarnessProviderAccessInput): Promise<HarnessResult<void>> {
  try {
    const expectedHash = buildProviderSyncHash(await getEnabledProviderCredentialsForUser(input.userId))
    const current = await instanceService.findProviderSyncBySlug(slug)
    if (
      !input.force &&
      current?.status === 'running' &&
      !shouldRefreshProviderAccess({ expectedHash, providerSyncHash: current.providerSyncHash, providerSyncedAt: current.providerSyncedAt })
    ) {
      return { ok: true, data: undefined }
    }

    if (await messageRunService.hasActiveRunForSlug(slug, { ignoreRunId: input.ignoreActiveRunId })) {
      console.warn('[opencode-v2/providers] Deferred provider sync while workspace runs are active', { slug })
      return { ok: true, data: undefined }
    }

    const connection = await getInstanceBasicAuth(slug)
    if (!connection) return harnessFailure('instance_unavailable')
    return syncProviderAccessForInstance({ connection, slug, userId: input.userId, reload: true })
  } catch (error) {
    return harnessFailure('sync_failed', error instanceof Error ? error.message : undefined)
  }
}

export async function syncProviderAccess(slug: string, input: HarnessProviderAccessInput): Promise<HarnessResult<void>> {
  return withProviderSyncLock(slug, async () => {
    if (!input.connection && input.disposeInstance === undefined) return ensureProviderAccessFreshForExecution(slug, input)
    let connection: Connection | null
    try {
      connection = input.connection ?? await getInstanceBasicAuth(slug)
    } catch {
      return harnessFailure('instance_unavailable')
    }
    if (!connection) return harnessFailure('instance_unavailable')
    return syncProviderAccessForInstance({ connection, slug, userId: input.userId, reload: input.disposeInstance !== false })
  })
}
