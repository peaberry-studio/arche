import { NextResponse } from 'next/server'

import {
  loadAgentConnectorCapabilityOptions,
  type AgentConnectorCapabilityOption,
} from '@/lib/agent-connector-capabilities'
import { withAuth } from '@/lib/runtime/with-auth'

type AgentConnectorCapabilitiesResponse = {
  connectors: AgentConnectorCapabilityOption[]
}

export const GET = withAuth<AgentConnectorCapabilitiesResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    // This catalog is global across workspaces; the slug is only used for authenticated routing.
    const connectors = await loadAgentConnectorCapabilityOptions()
    return NextResponse.json({ connectors })
  },
)
