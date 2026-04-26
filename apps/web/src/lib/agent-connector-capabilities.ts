import type { UserKind } from '@prisma/client'

import { getConnectorCapabilityId, type ConnectorCapabilityRecord } from '@/lib/agent-capabilities'
import {
  isSingleInstanceConnectorType,
  SINGLE_INSTANCE_CONNECTOR_TYPES,
  type ConnectorType,
} from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { connectorService } from '@/lib/services'

export type AgentConnectorCapabilityOption = {
  id: string
  type: ConnectorType
  name: string
  enabled: boolean
  scope: 'connector' | 'type'
  ownerKind: UserKind | null
  ownerSlug: string | null
}

const SINGLE_INSTANCE_CONNECTOR_LABELS = {
  linear: 'Linear',
  'meta-ads': 'Meta Ads',
  notion: 'Notion',
  zendesk: 'Zendesk',
  ahrefs: 'Ahrefs',
  umami: 'Umami',
  google_gmail: 'Gmail',
  google_drive: 'Google Drive',
  google_calendar: 'Google Calendar',
  google_chat: 'Google Chat',
  google_people: 'People API',
} as const satisfies Record<Exclude<ConnectorType, 'custom'>, string>

function isConnectorCapabilityAvailable(type: ConnectorType): boolean {
  if (type === 'meta-ads') {
    return getRuntimeCapabilities().metaAdsConnector
  }
  return true
}

export function buildAgentConnectorCapabilityOptions(entries: Array<{
  id: string
  type: string
  name: string
  enabled: boolean
  user: { kind: UserKind; slug: string }
}>): AgentConnectorCapabilityOption[] {
  const options = new Map<string, AgentConnectorCapabilityOption>()

  for (const type of SINGLE_INSTANCE_CONNECTOR_TYPES) {
    if (!isConnectorCapabilityAvailable(type)) {
      continue
    }

    options.set(getConnectorCapabilityId(type, type), {
      id: getConnectorCapabilityId(type, type),
      type,
      name: SINGLE_INSTANCE_CONNECTOR_LABELS[type],
      enabled: false,
      scope: 'type',
      ownerKind: null,
      ownerSlug: null,
    })
  }

  for (const entry of entries) {
    if (!validateConnectorType(entry.type)) continue
    if (!isConnectorCapabilityAvailable(entry.type)) continue

    if (isSingleInstanceConnectorType(entry.type)) {
      const id = getConnectorCapabilityId(entry.type, entry.id)
      const existing = options.get(id)
      if (!existing) continue

      options.set(id, {
        ...existing,
        enabled: existing.enabled || entry.enabled,
      })
      continue
    }

    options.set(entry.id, {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      enabled: entry.enabled,
      scope: 'connector',
      ownerKind: entry.user.kind,
      ownerSlug: entry.user.slug,
    })
  }

  return Array.from(options.values()).sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope === 'type' ? -1 : 1
    }

    if (left.type !== right.type) {
      return left.type.localeCompare(right.type)
    }

    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }

    return (left.ownerSlug ?? '').localeCompare(right.ownerSlug ?? '')
  })
}

export async function loadAgentConnectorCapabilityOptions(): Promise<AgentConnectorCapabilityOption[]> {
  const entries = await connectorService.findCapabilityInventoryEntries()
  return buildAgentConnectorCapabilityOptions(entries)
}

export async function loadAvailableConnectorCapabilities(): Promise<ConnectorCapabilityRecord[]> {
  const connectors = await loadAgentConnectorCapabilityOptions()
  return connectors.map((connector) => ({
    id: connector.id,
    type: connector.type,
  }))
}
