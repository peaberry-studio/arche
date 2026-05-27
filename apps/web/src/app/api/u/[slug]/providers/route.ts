import { NextResponse } from 'next/server'

import { decryptProviderSecret } from '@/lib/providers/crypto'
import { getOllamaPublicDetails, type OllamaPublicDetails } from '@/lib/providers/ollama'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { providerService, userService } from '@/lib/services'

export type ProviderListStatus = 'enabled' | 'disabled' | 'missing'

export interface ProviderListItem {
  providerId: ProviderId
  status: ProviderListStatus
  source?: 'user' | 'organization'
  overrideStatus?: ProviderListStatus
  type?: string
  version?: number
  details?: OllamaPublicDetails
}

type ProviderListResponse = { providers: ProviderListItem[] }

type ProviderCredentialWithSecret = {
  providerId: string
  secret?: string
}

function getProviderDetails(
  credential: ProviderCredentialWithSecret | undefined,
  options: { includeBaseUrl?: boolean } = {},
): OllamaPublicDetails | undefined {
  if (credential?.providerId !== 'ollama' || !credential.secret) {
    return undefined
  }

  try {
    return getOllamaPublicDetails(decryptProviderSecret(credential.secret), options) ?? undefined
  } catch {
    return undefined
  }
}

export const GET = withAuth<ProviderListResponse | { error: string }>(
  { csrf: false },
    async (_request, { slug, user: sessionUser }) => {
    const user = await userService.findIdBySlug(slug)

    if (!user) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
    }

    const [credentials, organizationCredentials] = await Promise.all([
      providerService.findCredentialsByUserAndProviders(user.id, [...PROVIDERS]),
      providerService.findOrganizationCredentialsByProviders([...PROVIDERS]),
    ])

    const latestByProvider = new Map<ProviderId, (typeof credentials)[number]>()
    for (const credential of credentials) {
      const providerId = credential.providerId as ProviderId
      if (!latestByProvider.has(providerId)) {
        latestByProvider.set(providerId, credential)
      }
    }

    const latestOrganizationByProvider = new Map<ProviderId, (typeof organizationCredentials)[number]>()
    for (const credential of organizationCredentials) {
      const providerId = credential.providerId as ProviderId
      if (!latestOrganizationByProvider.has(providerId)) {
        latestOrganizationByProvider.set(providerId, credential)
      }
    }

    const providers = PROVIDERS.map((providerId) => {
      const credential = latestByProvider.get(providerId)
      const organizationCredential = latestOrganizationByProvider.get(providerId)
      const overrideStatus = credential?.status as ProviderListStatus | undefined

      if (credential?.status === 'enabled') {
        return {
          providerId,
          status: 'enabled' as const,
          source: 'user' as const,
          overrideStatus,
          type: credential.type ?? undefined,
          version: credential.version ?? undefined,
          details: getProviderDetails(credential),
        }
      }

      if (organizationCredential?.status === 'enabled') {
        return {
          providerId,
          status: 'enabled' as const,
          source: 'organization' as const,
          overrideStatus,
          type: organizationCredential.type ?? undefined,
          version: organizationCredential.version ?? undefined,
          details: getProviderDetails(organizationCredential, { includeBaseUrl: sessionUser.role === 'ADMIN' }),
        }
      }

      if (credential) {
        return {
          providerId,
          status: credential.status as ProviderListStatus,
          source: 'user' as const,
          overrideStatus,
          type: credential.type ?? undefined,
          version: credential.version ?? undefined,
          details: getProviderDetails(credential),
        }
      }

      return { providerId, status: 'missing' as const }
    })

    return NextResponse.json({ providers })
  }
)
