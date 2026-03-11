import { NextResponse } from 'next/server'

import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { providerService, userService } from '@/lib/services'

export type ProviderListStatus = 'enabled' | 'disabled' | 'missing'

export interface ProviderListItem {
  providerId: ProviderId
  status: ProviderListStatus
  type?: string
  version?: number
}

type ProviderListResponse = { providers: ProviderListItem[] }

export const GET = withAuth<ProviderListResponse | { error: string }>(
  { csrf: false },
  async (_request, { slug }) => {
    const user = await userService.findIdBySlug(slug)

    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const credentials = await providerService.findCredentialsByUserAndProviders(user.id, [...PROVIDERS])

    const latestByProvider = new Map<ProviderId, (typeof credentials)[number]>()
    for (const credential of credentials) {
      const providerId = credential.providerId as ProviderId
      if (!latestByProvider.has(providerId)) {
        latestByProvider.set(providerId, credential)
      }
    }

    const providers = PROVIDERS.map((providerId) => {
      const credential = latestByProvider.get(providerId)
      if (!credential) {
        return { providerId, status: 'missing' as const }
      }

      return {
        providerId,
        status: credential.status as ProviderListStatus,
        type: credential.type ?? undefined,
        version: credential.version ?? undefined,
      }
    })

    return NextResponse.json({ providers })
  }
)
