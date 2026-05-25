import { describe, expect, it } from 'vitest'

import { formatConnectorRequirement, getFlowErrorMessage } from '@/lib/flows/errors'

describe('flow errors', () => {
  it('formats user-facing run errors', () => {
    expect(getFlowErrorMessage('flow_busy')).toBe('This flow already has a run in progress. Try again after it finishes.')
    expect(getFlowErrorMessage('missing_connectors')).toBe('Configure the missing connectors before running this flow.')
    expect(getFlowErrorMessage('network_error')).toBe('Network error. Try again.')
    expect(getFlowErrorMessage('not_found')).toBe('not_found')
  })

  it('formats custom connector requirements by name', () => {
    expect(formatConnectorRequirement({
      agentId: 'agent-1',
      agentName: 'Agent',
      capabilityId: 'custom-1',
      connectorName: 'Acme MCP',
      connectorType: 'custom',
    })).toBe('Acme MCP (custom)')

    expect(formatConnectorRequirement({
      agentId: 'agent-1',
      agentName: 'Agent',
      capabilityId: 'globalzendesk',
      connectorName: null,
      connectorType: 'zendesk',
    })).toBe('zendesk')
  })
})
