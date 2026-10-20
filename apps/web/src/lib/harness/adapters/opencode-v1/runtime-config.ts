import type { RuntimeConfigModel, RuntimeConfigRenderResult } from '@/lib/harness/runtime-config'
import {
  applyAgentExecutionGuards,
  applyDefaultAgentModel,
  denyAgentKnowledgeWrites,
  injectAgentKnowledgePolicy,
  injectAgentToolCallerIdentity,
  injectSelfDelegationGuards,
} from '@/lib/spawner/agent-config-transforms'
import { serializeRuntimeConfig } from '@/lib/spawner/runtime-config'
import { withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'

export function renderRuntimeConfig(model: RuntimeConfigModel): RuntimeConfigRenderResult {
  let config: Record<string, unknown> = {
    ...model.settings,
    ...(model.modelDefaults.agent === undefined ? {} : { default_agent: model.modelDefaults.agent }),
    ...(model.modelDefaults.model === undefined ? {} : { default_model: model.modelDefaults.model }),
    ...(model.connectorTargets === undefined ? {} : { mcp: model.connectorTargets }),
    ...(model.providerTargets === undefined ? {} : { provider: model.providerTargets }),
    ...(model.access === undefined ? {} : { permission: model.access }),
    ...(model.tools === undefined ? {} : { tools: model.tools }),
    ...(model.agents === undefined ? {} : {
      agent: Object.fromEntries(model.agents.map((agent) => [agent.id, agent.invalidDefinition ? agent.invalidDefinition.value : {
        ...agent.settings,
        ...(agent.instructions === undefined ? {} : { prompt: agent.instructions }),
        ...(agent.model === undefined ? {} : { model: agent.model }),
        ...(agent.access === undefined ? {} : { permission: agent.access }),
        ...(agent.tools === undefined ? {} : { tools: agent.tools }),
      }])),
    }),
  }
  config = applyDefaultAgentModel(config)
  if (model.guards.execution) config = applyAgentExecutionGuards(config)
  if (model.guards.selfDelegation) config = injectSelfDelegationGuards(config)
  config = injectAgentToolCallerIdentity(config)
  config = injectAgentKnowledgePolicy(config)
  if (model.guards.knowledgeWrites) config = denyAgentKnowledgeWrites(config)
  if (model.guards.workspace) config = withWorkspacePermissionGuards(config)
  return {
    ok: true,
    data: {
      config,
      opencodeConfigContent: serializeRuntimeConfig(config),
      agentsMd: model.agentsMd,
      skills: model.skills,
      skillDirectory: '.opencode/skill',
    },
  }
}
