import { NextResponse } from 'next/server'

import { decryptProviderSecret } from '@/lib/providers/crypto'
import { getOllamaPublicDetails, type OllamaPublicDetails } from '@/lib/providers/ollama'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { providerService } from '@/lib/services'

export type OrganizationProviderListStatus = 'enabled' | 'disabled' | 'missing'

export type OrganizationProviderListItem = {
  id?: string
  providerId: ProviderId
  status: OrganizationProviderListStatus
  type?: string
  version?: number
  lastUsedAt?: string | null
  details?: OllamaPublicDetails
}

type OrganizationProviderListResponse = { providers: OrganizationProviderListItem[] }

type OrganizationCredentialWithSecret = {
  providerId: string
  secret?: string
}

function getProviderDetails(credential: OrganizationCredentialWithSecret | undefined): OllamaPublicDetails | undefined {
  if (credential?.providerId !== 'ollama' || !credential.secret) {
    return undefined
  }

  try {
    return getOllamaPublicDetails(decryptProviderSecret(credential.secret)) ?? undefined
  } catch {
    return undefined
  }
}

export const GET = withAuth<OrganizationProviderListResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const credentials = await providerService.findOrganizationCredentialsByProviders([...PROVIDERS])
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
        id: credential.id,
        providerId,
        status: credential.status as OrganizationProviderListStatus,
        type: credential.type,
        version: credential.version,
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
        details: getProviderDetails(credential),
      }
    })

    return NextResponse.json({ providers })
  },
)
