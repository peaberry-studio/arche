import type { ProviderId } from '@/lib/providers/types'

export type TeamUserRole = 'USER' | 'ADMIN'

export type TeamUser = {
  id: string
  email: string
  slug: string
  role: TeamUserRole
  createdAt: string
}

export type ProviderStatus = 'enabled' | 'disabled' | 'missing'

export type TeamProviderStatus = {
  providerId: ProviderId
  status: ProviderStatus
  type?: string
  version?: number
}
