import { NextResponse } from 'next/server'

import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import { getRuntimeCapabilities, type RuntimeCapabilities } from '@/lib/runtime/capabilities'
import { requireCapability } from '@/lib/runtime/require-capability'

const CONNECTOR_RUNTIME_CAPABILITIES: Partial<Record<ConnectorType, keyof RuntimeCapabilities>> = {
  'meta-ads': 'metaAdsConnector',
}

export function requireConnectorCapability(type: string): NextResponse<{ error: string }> | null {
  if (!validateConnectorType(type)) return null

  const capability = CONNECTOR_RUNTIME_CAPABILITIES[type]
  return capability ? requireCapability(capability) : null
}

export function isConnectorCapabilityAvailable(type: string): boolean {
  if (!validateConnectorType(type)) return true

  const capability = CONNECTOR_RUNTIME_CAPABILITIES[type]
  return capability ? getRuntimeCapabilities()[capability] : true
}
