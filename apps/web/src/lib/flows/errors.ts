import type { FlowConnectorRequirementSummary } from '@/lib/flows/types'

export function getFlowErrorMessage(error: string): string {
  if (error === 'flow_busy') {
    return 'This flow already has a run in progress. Try again after it finishes.'
  }

  if (error === 'missing_connectors') {
    return 'Configure the missing connectors before running this flow.'
  }

  if (error === 'network_error') {
    return 'Network error. Try again.'
  }

  return error
}

export function formatConnectorRequirement(requirement: FlowConnectorRequirementSummary): string {
  if (requirement.connectorType === 'custom' && requirement.connectorName) {
    return `${requirement.connectorName} (custom)`
  }

  return requirement.connectorType
}
