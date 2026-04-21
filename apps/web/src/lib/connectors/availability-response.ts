import { NextResponse } from 'next/server'

import {
  getConnectorTypeAvailabilityMessage,
  isConnectorTypeAvailable,
} from '@/lib/connectors/availability'
import { isConnectorType } from '@/lib/connectors/types'

type ConnectorAvailabilityResponse = {
  error: 'connector_not_available'
  message: string
}

export function requireAvailableConnectorType(
  type: string,
): NextResponse<ConnectorAvailabilityResponse> | null {
  if (!isConnectorType(type) || isConnectorTypeAvailable(type)) {
    return null
  }

  return NextResponse.json(
    {
      error: 'connector_not_available',
      message: getConnectorTypeAvailabilityMessage(type) ?? 'Connector type is not available in this runtime mode.',
    },
    { status: 403 },
  )
}
