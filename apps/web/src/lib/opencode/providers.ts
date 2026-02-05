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
    const configBody = {
      enabled_providers: [...PROVIDERS],
      provider: {
        openai: {
          options: {
            baseURL: getGatewayBaseUrlForProvider('openai'),
          },
        },
        anthropic: {
          options: {
            baseURL: getGatewayBaseUrlForProvider('anthropic'),
          },
        },
        openrouter: {
          options: {
            baseURL: getGatewayBaseUrlForProvider('openrouter'),
          },
        },
      },
    }

    await client.config.update({ body: configBody })

    for (const providerId of PROVIDERS) {
      const credential = await getActiveCredentialForUser({
        userId: input.userId,
        providerId: providerId as ProviderId,
      })

      if (!credential) continue

      const token = issueGatewayToken({
        userId: input.userId,
        workspaceSlug: input.slug,
        providerId: providerId as ProviderId,
        version: credential.version,
      })

      await client.auth.set({
        path: { id: providerId },
        body: { type: 'api', key: token },
      })
    }

    return { ok: true }
  } catch (error) {
    console.error('[opencode/providers] Failed to sync providers', error)
    return { ok: false, error: 'sync_failed' }
  }
}
