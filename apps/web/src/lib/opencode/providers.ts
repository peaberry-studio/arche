import crypto from 'node:crypto'

import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { getGatewayTokenTtlSeconds } from '@/lib/providers/config'
import { toRuntimeProviderId } from '@/lib/providers/catalog'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { instanceService } from '@/lib/services'

export type SyncProviderAccessResult =
  | { ok: true }
  | { ok: false; error: 'instance_unavailable' | 'sync_failed' }

type SyncProviderAccessInput = {
  instance: { baseUrl: string; authHeader: string }
  slug: string
  userId: string
  disposeInstance?: boolean
}

// Refresh slightly before the gateway token expires so long-running runs do not
// reuse credentials that are about to age out.
const PROVIDER_SYNC_REFRESH_SKEW_MS = 60_000
const providerSyncLocks = new Map<string, Promise<void>>()

type EnabledProviderVersions = Map<ProviderId, { version: number }>

function buildProviderSyncHash(enabledByProvider: EnabledProviderVersions): string {
  // Only configured providers affect runtime auth. Missing credentials and
  // providers that require no managed sync intentionally hash to the same state.
  const payload = Array.from(enabledByProvider.entries())
    .map(([providerId, value]) => ({ providerId, version: value.version }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId))

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function loadEnabledProviderVersions(userId: string): Promise<EnabledProviderVersions> {
  const enabledByProvider = new Map<ProviderId, { version: number }>()

  for (const providerId of PROVIDERS) {
    const credential = await getActiveCredentialForUser({
      userId,
      providerId,
    })
    if (!credential) {
      continue
    }

    enabledByProvider.set(providerId, { version: Number(credential.version) })
  }

  return enabledByProvider
}

function shouldRefreshProviderAccess(args: {
  expectedHash: string
  providerSyncHash: string | null
  providerSyncedAt: Date | null
}): boolean {
  if (args.providerSyncHash !== args.expectedHash) {
    return true
  }

  if (!args.providerSyncedAt) {
    return true
  }

  const ttlMs = getGatewayTokenTtlSeconds() * 1000
  const refreshAgeMs = Math.max(0, ttlMs - PROVIDER_SYNC_REFRESH_SKEW_MS)
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

    if (providerSyncLocks.get(slug) === current) {
      providerSyncLocks.delete(slug)
    }
  }
}

export async function getProviderSyncHashForUser(userId: string): Promise<string> {
  return buildProviderSyncHash(await loadEnabledProviderVersions(userId))
}

export async function ensureProviderAccessFreshForExecution(args: {
  slug: string
  userId: string
}): Promise<void> {
  await withProviderSyncLock(args.slug, async () => {
    const expectedHash = await getProviderSyncHashForUser(args.userId)
    const current = await instanceService.findProviderSyncBySlug(args.slug)

    if (
      current?.status === 'running' &&
      !shouldRefreshProviderAccess({
        expectedHash,
        providerSyncHash: current.providerSyncHash,
        providerSyncedAt: current.providerSyncedAt,
      })
    ) {
      return
    }

    const instance = await getInstanceBasicAuth(args.slug)
    if (!instance) {
      throw new Error('instance_unavailable')
    }

    const syncResult = await syncProviderAccessForInstance({
      instance,
      slug: args.slug,
      userId: args.userId,
    })

    if (!syncResult.ok) {
      throw new Error(syncResult.error)
    }
  })
}

async function fetchRequired(
  url: string,
  init: RequestInit,
  allowedStatuses: number[] = [],
): Promise<void> {
  const response = await fetch(url, init)
  if (response.ok || allowedStatuses.includes(response.status)) {
    return
  }

  throw new Error(`provider_sync_failed:${init.method ?? 'GET'}:${url}:${response.status}`)
}

export async function syncProviderAccessForInstance(
  input: SyncProviderAccessInput,
): Promise<SyncProviderAccessResult> {
  const instance = input.instance

  try {
    const enabledByProvider = await loadEnabledProviderVersions(input.userId)
    const providerSyncHash = buildProviderSyncHash(enabledByProvider)

    for (const providerId of PROVIDERS) {
      const enabled = enabledByProvider.get(providerId)
      const url = `${instance.baseUrl}/auth/${toRuntimeProviderId(providerId)}`

      if (!enabled) {
        if (providerId === 'opencode') {
          const token = issueGatewayToken({
            userId: input.userId,
            workspaceSlug: input.slug,
            providerId: 'opencode',
            version: 0,
          })

          await fetchRequired(url, {
            method: 'PUT',
            headers: {
              Authorization: instance.authHeader,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'api', key: token }),
            cache: 'no-store',
          })
          continue
        }

        await fetchRequired(
          url,
          {
            method: 'DELETE',
            headers: {
              Authorization: instance.authHeader,
              Accept: 'application/json',
            },
            cache: 'no-store',
          },
          [404],
        )
        continue
      }

      const token = issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId,
        version: enabled.version,
      })

      await fetchRequired(url, {
        method: 'PUT',
        headers: {
          Authorization: instance.authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'api', key: token }),
        cache: 'no-store',
      })
    }

    if (input.disposeInstance !== false) {
      // OpenCode caches provider discovery; dispose to reload with updated auth.
      await fetchRequired(`${instance.baseUrl}/instance/dispose`, {
        method: 'POST',
        headers: {
          Authorization: instance.authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
    }

    try {
      await instanceService.setProviderSyncState(input.slug, providerSyncHash, new Date())
    } catch (error) {
      console.error('[opencode/providers] Failed to persist provider sync state', error)
    }

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
