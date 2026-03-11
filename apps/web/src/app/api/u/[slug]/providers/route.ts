import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'

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
    const user = await prisma.user.findUnique({
      where: { slug },
      select: { id: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const credentials = await prisma.providerCredential.findMany({
      where: {
        userId: user.id,
        providerId: { in: [...PROVIDERS] },
      },
      select: {
        providerId: true,
        status: true,
        type: true,
        version: true,
      },
      orderBy: {
        version: 'desc',
      },
    })

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
        status: credential.status,
        type: credential.type ?? undefined,
        version: credential.version ?? undefined,
      }
    })

    return NextResponse.json({ providers })
  }
)
