import { toRuntimeProviderId } from '@/lib/providers/catalog'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

export type SyncProviderAccessResult =
  | { ok: true }
  | { ok: false; error: 'instance_unavailable' | 'sync_failed' }

type SyncProviderAccessInput = {
  instance: { baseUrl: string; authHeader: string }
  slug: string
  userId: string
  disposeInstance?: boolean
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
    const enabledByProvider = new Map<ProviderId, { version: number }>()

    for (const providerId of PROVIDERS) {
      const pid = providerId as ProviderId
      const credential = await getActiveCredentialForUser({
        userId: input.userId,
        providerId: pid,
      })
      if (!credential) continue
      enabledByProvider.set(pid, { version: credential.version })
    }

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

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
