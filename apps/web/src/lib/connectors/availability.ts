import { CONNECTOR_TYPES, type ConnectorType } from '@/lib/connectors/types'
import { getRuntimeMode, type RuntimeMode } from '@/lib/runtime/mode'

const UNAVAILABLE_CONNECTOR_TYPES_BY_MODE: Record<RuntimeMode, ReadonlySet<ConnectorType>> = {
  web: new Set<ConnectorType>(),
  desktop: new Set<ConnectorType>(['meta-ads']),
}

const CONNECTOR_TYPE_AVAILABILITY_MESSAGES: Partial<Record<ConnectorType, string>> = {
  'meta-ads': 'Meta Ads connectors are only available in the VPS runtime.',
}

export function isConnectorTypeAvailable(
  type: ConnectorType,
  runtimeMode: RuntimeMode = getRuntimeMode(),
): boolean {
  return !UNAVAILABLE_CONNECTOR_TYPES_BY_MODE[runtimeMode].has(type)
}

export function getAvailableConnectorTypes(
  runtimeMode: RuntimeMode = getRuntimeMode(),
): ConnectorType[] {
  return CONNECTOR_TYPES.filter((type) => isConnectorTypeAvailable(type, runtimeMode))
}

export function getConnectorTypeAvailabilityMessage(
  type: ConnectorType,
  runtimeMode: RuntimeMode = getRuntimeMode(),
): string | null {
  if (isConnectorTypeAvailable(type, runtimeMode)) {
    return null
  }

  return CONNECTOR_TYPE_AVAILABILITY_MESSAGES[type]
    ?? `${type} connectors are not available in the ${runtimeMode} runtime.`
}
