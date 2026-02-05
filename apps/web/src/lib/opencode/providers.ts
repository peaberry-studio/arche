import { createInstanceClient } from '@/lib/opencode/client'
import { getGatewayBaseUrlForProvider } from '@/lib/providers/config'
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
  const client = await createInstanceClient(input.slug)
  if (!client) {
    return { ok: false, error: 'instance_unavailable' }
  }

  try {
    const enabledProviders: ProviderId[] = []
    const providerConfig: Record<string, { options: { baseURL: string } }> = {}
    const credentialsByProvider = new Map<ProviderId, { version: number }>()

    for (const providerId of PROVIDERS) {
      const pid = providerId as ProviderId
      const credential = await getActiveCredentialForUser({
        userId: input.userId,
        providerId: pid,
      })
      if (!credential) continue

      enabledProviders.push(pid)
      providerConfig[pid] = {
        options: {
          baseURL: getGatewayBaseUrlForProvider(pid),
        },
      }
      credentialsByProvider.set(pid, { version: credential.version })
    }

    const configBody = {
      enabled_providers: enabledProviders,
      provider: providerConfig,
    }

    await client.config.update({ config: configBody })

    for (const providerId of enabledProviders) {
      const credential = credentialsByProvider.get(providerId)
      if (!credential) continue

      const token = issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId,
        version: credential.version,
      })

      await client.auth.set({
        providerID: providerId,
        auth: { type: 'api', key: token },
      })
    }

    // OpenCode caches provider discovery; dispose to reload with updated config/auth.
    await client.instance.dispose().catch(() => {})

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
