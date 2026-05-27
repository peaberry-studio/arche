import { NextResponse } from 'next/server'

import { listFlowAgentOptions } from '@/lib/flows/agents'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope, type FlowActorScope } from '@/lib/flows/authorization'
import {
  validateFlowTemplateImport,
  type FlowTemplate,
  type FlowTemplateImportWarning,
} from '@/lib/flows/import-export'
import { analyzeFlowSlackTargets, type FlowSlackTargetIssue } from '@/lib/flows/slack-targets'
import type { FlowDefinition, FlowPayload } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowImportValidateRouteParams = {
  slug: string
}

type FlowImportValidateResponse =
  | { draftPayload: FlowPayload; template: FlowTemplate; warnings: FlowTemplateImportWarning[] }
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

function slackIssueWarning(issue: FlowSlackTargetIssue): FlowTemplateImportWarning {
  if (issue.code === 'slack_integration_disabled') {
    return {
      code: issue.code,
      message: 'Slack is not enabled in this workspace. Review Slack steps before saving.',
    }
  }

  const stepName = issue.nodeName ?? 'Slack step'
  if (issue.code === 'unknown_slack_dm_target') {
    return {
      code: issue.code,
      message: `Slack step "${stepName}" targets a user that is not available in this workspace.`,
      nodeId: issue.nodeId,
      value: issue.value,
    }
  }
  if (issue.code === 'slack_dm_target_forbidden') {
    return {
      code: issue.code,
      message: `Slack step "${stepName}" targets another user's DM. Choose a permitted target before saving.`,
      nodeId: issue.nodeId,
      value: issue.value,
    }
  }
  if (issue.code === 'unknown_slack_channel_target') {
    return {
      code: issue.code,
      message: `Slack step "${stepName}" targets a channel that is not available in this workspace.`,
      nodeId: issue.nodeId,
      value: issue.value,
    }
  }

  return {
    code: issue.code,
    message: `Slack step "${stepName}" targets a private channel. Choose a permitted target before saving.`,
    nodeId: issue.nodeId,
    value: issue.value,
  }
}

async function collectSlackWarnings(
  definition: FlowDefinition,
  contextUser: { id: string; role: string },
  workspaceUserId: string,
): Promise<FlowTemplateImportWarning[]> {
  const issues = await analyzeFlowSlackTargets(definition, contextUser, workspaceUserId)
  return issues.map(slackIssueWarning)
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
    const [nameConflictWarnings, agentWarnings, slackWarnings] = await Promise.all([
      collectNameConflictWarnings(validation.draftPayload.name, scope, routeContext.workspaceUserId),
      collectAgentWarnings(validation.draftPayload.definition),
      collectSlackWarnings(validation.draftPayload.definition, user, routeContext.workspaceUserId),
    ])
    const warnings = [
      ...validation.warnings,
      ...nameConflictWarnings,
      ...agentWarnings,
      ...slackWarnings,
    ]

    return NextResponse.json({
      draftPayload: validation.draftPayload,
      template: validation.template,
      warnings,
    })
  },
)
