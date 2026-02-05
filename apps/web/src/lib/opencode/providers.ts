import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

export type SyncProviderAccessResult =
  | { ok: true }
  | { ok: false; error: 'instance_unavailable' | 'sync_failed' }

type SyncProviderAccessInput = {
  slug: string
  userId: string
}

export async function syncProviderAccessForInstance(
  input: SyncProviderAccessInput,
): Promise<SyncProviderAccessResult> {
  const instance = await getInstanceBasicAuth(input.slug)
  if (!instance) {
    return { ok: false, error: 'instance_unavailable' }
  }

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
      const enabled = enabledByProvider.get(providerId as ProviderId)
      const url = `${instance.baseUrl}/auth/${providerId}`

      if (!enabled) {
        await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: instance.authHeader,
            Accept: 'application/json',
          },
          cache: 'no-store',
        }).catch(() => {})
        continue
      }

      const token = issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId: providerId as ProviderId,
        version: enabled.version,
      })

      await fetch(url, {
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

    // OpenCode caches provider discovery; dispose to reload with updated auth.
    await fetch(`${instance.baseUrl}/instance/dispose`, {
      method: 'POST',
      headers: {
        Authorization: instance.authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }).catch(() => {})

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
