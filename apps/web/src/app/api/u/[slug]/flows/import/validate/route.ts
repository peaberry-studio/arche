import { NextResponse } from 'next/server'

import { listFlowAgentOptions } from '@/lib/flows/agents'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope, type FlowActorScope } from '@/lib/flows/authorization'
import {
  validateFlowTemplateImport,
  type FlowTemplate,
  type FlowTemplateImportWarning,
} from '@/lib/flows/import-export'
import type { FlowDefinition, FlowPayload } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService, slackService, userService } from '@/lib/services'

type FlowImportValidateRouteParams = {
  slug: string
}

type FlowImportValidateResponse =
  | { payload: FlowPayload; template: FlowTemplate; warnings: FlowTemplateImportWarning[] }
  | { error: string }

function getUnknownAgentWarnings(definition: FlowDefinition, knownAgentIds: ReadonlySet<string>): FlowTemplateImportWarning[] {
  return definition.nodes.flatMap((node) => {
    if (node.type !== 'agent' || !node.targetAgentId || knownAgentIds.has(node.targetAgentId)) return []
    return [{
      code: 'unknown_target_agent',
      message: `Agent step "${node.name}" targets an agent that is not available in this workspace.`,
      nodeId: node.id,
      value: node.targetAgentId,
    }]
  })
}

async function collectAgentWarnings(definition: FlowDefinition): Promise<FlowTemplateImportWarning[]> {
  const targetAgentIds = new Set(definition.nodes.flatMap((node) => (
    node.type === 'agent' && node.targetAgentId ? [node.targetAgentId] : []
  )))
  if (targetAgentIds.size === 0) return []

  const agentsResult = await listFlowAgentOptions()
  if (!agentsResult.ok) {
    return [{
      code: 'agent_options_unavailable',
      message: 'Agent availability could not be checked. Review target agents before saving.',
    }]
  }

  return getUnknownAgentWarnings(
    definition,
    new Set(agentsResult.agents.map((agent) => agent.id)),
  )
}

async function collectSlackWarnings(
  definition: FlowDefinition,
  contextUser: { id: string; role: string },
  workspaceUserId: string,
): Promise<FlowTemplateImportWarning[]> {
  const slackNodes = definition.nodes.filter((node) => node.type === 'slack')
  if (slackNodes.length === 0) return []

  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.slackTeamId) {
    return [{
      code: 'slack_integration_disabled',
      message: 'Slack is not enabled in this workspace. Review Slack steps before saving.',
    }]
  }

  const warnings: FlowTemplateImportWarning[] = []
  const channelsById = new Map<string, { isPrivate: boolean }>()
  if (slackNodes.some((node) => node.target.type === 'channel')) {
    const channels = await slackService.listEnabledNotificationChannels(integration.slackTeamId)
    for (const channel of channels) {
      channelsById.set(channel.channelId, { isPrivate: channel.isPrivate })
    }
  }

  for (const node of slackNodes) {
    if (node.target.type === 'dm') {
      const member = await userService.findTeamMemberById(node.target.userId)
      if (!member) {
        warnings.push({
          code: 'unknown_slack_dm_target',
          message: `Slack step "${node.name}" targets a user that is not available in this workspace.`,
          nodeId: node.id,
          value: node.target.userId,
        })
        continue
      }

      if (contextUser.role !== 'ADMIN' && node.target.userId !== workspaceUserId) {
        warnings.push({
          code: 'slack_dm_target_forbidden',
          message: `Slack step "${node.name}" targets another user's DM. Choose a permitted target before saving.`,
          nodeId: node.id,
          value: node.target.userId,
        })
      }
      continue
    }

    const channel = channelsById.get(node.target.channelId)
    if (!channel) {
      warnings.push({
        code: 'unknown_slack_channel_target',
        message: `Slack step "${node.name}" targets a channel that is not available in this workspace.`,
        nodeId: node.id,
        value: node.target.channelId,
      })
      continue
    }

    if (contextUser.role !== 'ADMIN' && channel.isPrivate) {
      warnings.push({
        code: 'slack_private_channel_forbidden',
        message: `Slack step "${node.name}" targets a private channel. Choose a permitted target before saving.`,
        nodeId: node.id,
        value: node.target.channelId,
      })
    }
  }

  return warnings
}

async function collectNameConflictWarnings(
  name: string,
  scope: FlowActorScope,
  workspaceUserId: string,
): Promise<FlowTemplateImportWarning[]> {
  const flows = await flowService.listFlowsForScope(scope)
  const existing = flows.find((flow) => (
    flow.userId === workspaceUserId && flow.name.toLowerCase() === name.toLowerCase()
  ))
  if (!existing) return []

  return [{
    code: 'flow_name_exists',
    message: 'A flow with this name already exists. Rename the draft before saving if needed.',
    value: name,
  }]
}

export const POST = withAuth<FlowImportValidateResponse, FlowImportValidateRouteParams>(
  { csrf: true },
  async (request, { slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    const validation = await validateFlowTemplateImport(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const scope = createFlowActorScope(user, routeContext.workspaceUserId)
    const warnings = [
      ...validation.warnings,
      ...await collectNameConflictWarnings(validation.payload.name, scope, routeContext.workspaceUserId),
      ...await collectAgentWarnings(validation.payload.definition),
      ...await collectSlackWarnings(validation.payload.definition, user, routeContext.workspaceUserId),
    ]

    return NextResponse.json({
      payload: validation.payload,
      template: validation.template,
      warnings,
    })
  },
)
