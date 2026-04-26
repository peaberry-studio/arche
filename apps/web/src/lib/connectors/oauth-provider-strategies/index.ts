import type { OAuthConnectorType } from '@/lib/connectors/types'
import { customStrategy } from '@/lib/connectors/oauth-provider-strategies/custom'
import {
  googleCalendarStrategy,
  googleChatStrategy,
  googleDriveStrategy,
  googleGmailStrategy,
  googlePeopleStrategy,
} from '@/lib/connectors/oauth-provider-strategies/google-workspace'
import { linearStrategy } from '@/lib/connectors/oauth-provider-strategies/linear'
import { metaAdsStrategy } from '@/lib/connectors/oauth-provider-strategies/meta-ads'
import { notionStrategy } from '@/lib/connectors/oauth-provider-strategies/notion'
import type { OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export type { OAuthMetadataOverrides, OAuthClientRegistration, OAuthProviderStrategy } from '@/lib/connectors/oauth-provider-strategies/types'

export const strategies: Record<OAuthConnectorType, OAuthProviderStrategy> = {
  linear: linearStrategy,
  notion: notionStrategy,
  custom: customStrategy,
  'meta-ads': metaAdsStrategy,
  google_gmail: googleGmailStrategy,
  google_drive: googleDriveStrategy,
  google_calendar: googleCalendarStrategy,
  google_chat: googleChatStrategy,
  google_people: googlePeopleStrategy,
}

export function getStrategy(type: OAuthConnectorType): OAuthProviderStrategy {
  return strategies[type]
}
