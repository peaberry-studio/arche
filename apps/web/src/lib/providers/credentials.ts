export type ProviderCredentialRecord = {
  id: string
  type: string
  secret: string
  version: number
}

export type ProviderCredentialSource = 'user' | 'organization'

export type EffectiveProviderCredential =
  | { source: ProviderCredentialSource; credential: ProviderCredentialRecord }
  | null

export type ProviderCredentialSummary = {
  providerId: string
  status: string
  type: string
  version: number
}

export type OrganizationProviderCredentialSummary = ProviderCredentialSummary & {
  id: string
  lastUsedAt: Date | null
}
