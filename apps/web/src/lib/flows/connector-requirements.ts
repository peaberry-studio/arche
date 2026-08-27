import { getConnectorCapabilityId } from '@/lib/agent-capabilities'
import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorType } from '@/lib/connectors/validators'
import type { FlowDefinition } from '@/lib/flows/types'
import { connectorService } from '@/lib/services'
import {
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export type FlowConnectorRequirement = {
  agentId: string
  agentName: string
  capabilityId: string
  connectorName: string | null
  connectorType: ConnectorType
}

type FlowConnectorRequirementsResult =
  | { ok: true; requirements: FlowConnectorRequirement[] }
  | { ok: false; error: string }

function uniqueRequirements(requirements: FlowConnectorRequirement[]): FlowConnectorRequirement[] {
  const seen = new Set<string>()
  const unique: FlowConnectorRequirement[] = []

  for (const requirement of requirements) {
    const key = `${requirement.agentId}:${requirement.capabilityId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(requirement)
  }

  return unique.sort((left, right) => {
    const agentSort = left.agentName.localeCompare(right.agentName)
    if (agentSort !== 0) return agentSort
    return left.capabilityId.localeCompare(right.capabilityId)
  })
}

async function resolveDeclaredConnectors(
  requirements: FlowConnectorRequirement[],
): Promise<FlowConnectorRequirement[]> {
  const declaredIds = Array.from(new Set(requirements.map((requirement) => requirement.capabilityId)))
  if (declaredIds.length === 0) return []

  const connectors = await connectorService.findManyByIds(declaredIds)
  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]))

  return requirements.map((requirement) => {
    const connector = connectorById.get(requirement.capabilityId)
    // A declared id without a connector record keeps its raw id as capability id,
    // so it can never match an enabled connector and is reported missing.
    if (!connector || !validateConnectorType(connector.type)) return requirement

    return {
      ...requirement,
      capabilityId: getConnectorCapabilityId(connector.type, connector.id),
      connectorName: connector.name,
      connectorType: connector.type,
    }
  })
}

export async function getFlowConnectorRequirements(
  definition: FlowDefinition,
): Promise<FlowConnectorRequirementsResult> {
  const configResult = await readCommonWorkspaceConfig()
  if (!configResult.ok) return { ok: false, error: configResult.error }

  const parsed = parseCommonWorkspaceConfig(configResult.content)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) return { ok: false, error: validation.error ?? 'invalid_config' }

  const agents = getAgentSummaries(parsed.config)
  const primaryAgent = agents.find((agent) => agent.isPrimary) ?? agents[0]
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const requirements: FlowConnectorRequirement[] = []

  for (const node of definition.nodes) {
    if (node.type !== 'agent') continue
    if (!node.requiredConnectors?.length) continue

    const agent = node.targetAgentId ? agentsById.get(node.targetAgentId) : primaryAgent
    if (!agent) continue

    for (const connectorId of node.requiredConnectors) {
      requirements.push({
        agentId: agent.id,
        agentName: agent.displayName,
        capabilityId: connectorId,
        connectorName: null,
        connectorType: 'custom',
      })
    }
  }

  return { ok: true, requirements: await resolveDeclaredConnectors(uniqueRequirements(requirements)) }
}

export async function checkMissingConnectorRequirements(
  requirements: FlowConnectorRequirement[],
  executionUserId: string,
): Promise<FlowConnectorRequirement[]> {
  if (requirements.length === 0) return []

  const connectors = await connectorService.findEnabledByUserId(executionUserId)
  const availableCapabilityIds = new Set<string>()
  const availableCustomNameCounts = new Map<string, number>()

  for (const connector of connectors) {
    if (!validateConnectorType(connector.type)) continue
    availableCapabilityIds.add(getConnectorCapabilityId(connector.type, connector.id))

    if (connector.type === 'custom') {
      const name = connector.name.trim()
      availableCustomNameCounts.set(name, (availableCustomNameCounts.get(name) ?? 0) + 1)
    }
  }

  return requirements.filter((requirement) => {
    if (availableCapabilityIds.has(requirement.capabilityId)) return false
    if (requirement.connectorType !== 'custom' || !requirement.connectorName) return true

    return (availableCustomNameCounts.get(requirement.connectorName.trim()) ?? 0) !== 1
  })
}
