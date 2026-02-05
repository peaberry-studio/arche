import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser } from '@/lib/auth'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

export type ProviderListStatus = 'enabled' | 'disabled' | 'missing'

export interface ProviderListItem {
  providerId: ProviderId
  status: ProviderListStatus
  type?: string
  version?: number
}

type ProviderListResponse = { providers: ProviderListItem[] }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<ProviderListResponse | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

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
      providerId: { in: PROVIDERS },
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
