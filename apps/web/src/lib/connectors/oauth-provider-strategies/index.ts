import type { OAuthConnectorType } from '@/lib/connectors/types'
import { customStrategy } from '@/lib/connectors/oauth-provider-strategies/custom'
import { linearStrategy } from '@/lib/connectors/oauth-provider-strategies/linear'
import { notionStrategy } from '@/lib/connectors/oauth-provider-strategies/notion'
import type { OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export type { OAuthMetadataOverrides, OAuthClientRegistration, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export const strategies: Record<OAuthConnectorType, OAuthProviderStrategy> = {
  linear: linearStrategy,
  notion: notionStrategy,
  custom: customStrategy,
}

export function getStrategy(type: OAuthConnectorType): OAuthProviderStrategy {
  return strategies[type]
}
