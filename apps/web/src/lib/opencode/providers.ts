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

export async function syncProviderAccessForInstance(
  input: SyncProviderAccessInput,
): Promise<SyncProviderAccessResult> {
  const instance = input.instance

  try {
    const enabledByProvider = new Map<ProviderId, { version: number }>()

    for (const providerId of PROVIDERS) {
      const credential = await getActiveCredentialForUser({
        userId: input.userId,
        providerId,
      })
      if (!credential) continue
      enabledByProvider.set(providerId, { version: credential.version })
    }

    for (const providerId of PROVIDERS) {
      const enabled = enabledByProvider.get(providerId)
      const url = `${instance.baseUrl}/auth/${providerId}`

      if (!enabled) {
        if (providerId === 'opencode') {
          // Keep OpenCode provider authenticated through gateway even without an
          // Arche-managed credential. Gateway token version 0 maps to public Zen access.
          const token = issueGatewayToken({
            userId: input.userId,
            workspaceSlug: input.slug,
            providerId,
            version: 0,
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
          continue
        }

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
        providerId,
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

    if (input.disposeInstance !== false) {
      // OpenCode caches provider discovery; dispose to reload with updated auth.
      await fetch(`${instance.baseUrl}/instance/dispose`, {
        method: 'POST',
        headers: {
          Authorization: instance.authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }).catch(() => {})
    }

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
