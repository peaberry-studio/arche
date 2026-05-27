import type { ProviderId } from '@/lib/providers/types'
import type { OllamaPublicDetails } from '@/lib/providers/ollama'

export type TeamUserRole = 'USER' | 'ADMIN'

export type TeamUser = {
  id: string
  email: string
  slug: string
  role: TeamUserRole
  createdAt: string
}

export type ProviderStatus = 'enabled' | 'disabled' | 'missing'
export type ProviderCredentialSource = 'user' | 'organization'

export type TeamProviderStatus = {
  providerId: ProviderId
  status: ProviderStatus
  source?: ProviderCredentialSource
  overrideStatus?: ProviderStatus
  type?: string
  version?: number
  details?: OllamaPublicDetails
}
