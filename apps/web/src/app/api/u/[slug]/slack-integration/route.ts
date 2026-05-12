import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { withAuth } from '@/lib/runtime/with-auth'
import { loadSlackAgentOptions } from '@/lib/slack/agents'
import { requireSlackIntegrationAdmin } from '@/lib/slack/route-auth'

import {
  isSlackAppToken,
  isSlackBotToken,
  serializeSlackIntegration,
  testSlackCredentials,
} from '@/lib/slack/integration'
import { ensureSlackServiceUser } from '@/lib/slack/service-user'
import { syncSlackSocketManager } from '@/lib/slack/socket-mode'
import type {
  SlackIntegrationGetResponse,
  SlackIntegrationMutateRequest,
  SlackIntegrationMutateResponse,
} from '@/lib/slack/types'
import { slackService } from '@/lib/services'

type JsonObject = Record<string, unknown>

function normalizeAgentId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toErrorResponse(error: string, status: number, message?: string) {
  return NextResponse.json(
    message ? { error, message } : { error },
    { status },
  )
}

async function loadSlackSettingsResponse(): Promise<
  | { ok: true; response: SlackIntegrationGetResponse }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const [agentOptions, integration] = await Promise.all([
    loadSlackAgentOptions(),
    slackService.findIntegration(),
  ])

  if (!agentOptions.ok) {
    const status = agentOptions.error === 'kb_unavailable' ? 503 : 500
    return {
      ok: false,
      response: NextResponse.json({ error: agentOptions.error }, { status }),
    }
  }

  return {
    ok: true,
    response: {
      agents: agentOptions.agents,
      integration: serializeSlackIntegration(integration, agentOptions.primaryAgentId),
    },
  }
}

async function parseJsonObject(request: NextRequest): Promise<
  | { ok: true; body: JsonObject }
  | { ok: false; response: NextResponse<{ error: string; message?: string }> }
> {
  let body: unknown

  try {
    body = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        response: toErrorResponse('invalid_json', 400),
      }
    }

    throw error
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: toErrorResponse('invalid_body', 400),
    }
  }

  return { ok: true, body: body as JsonObject }
}

export const GET = withAuth<SlackIntegrationGetResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireSlackIntegrationAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const result = await loadSlackSettingsResponse()
    if (!result.ok) {
      return result.response
    }

    return NextResponse.json(result.response)
  },
)

export const PUT = withAuth<SlackIntegrationMutateResponse | { error: string; message?: string }>(
  { csrf: true },
  async (request, { user }) => {
    const admin = requireSlackIntegrationAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const parsedBody = await parseJsonObject(request)
    if (!parsedBody.ok) {
      return parsedBody.response
    }

    const body = parsedBody.body as SlackIntegrationMutateRequest
    const existing = await slackService.findIntegration()
    const agentOptions = await loadSlackAgentOptions()
    if (!agentOptions.ok) {
      const status = agentOptions.error === 'kb_unavailable' ? 503 : 500
      return toErrorResponse(agentOptions.error, status)
    }

    const defaultAgentId =
      'defaultAgentId' in parsedBody.body
        ? normalizeAgentId(body.defaultAgentId)
        : existing?.defaultAgentId ?? null
    if (defaultAgentId && !agentOptions.agents.some((agent) => agent.id === defaultAgentId)) {
      return toErrorResponse('unknown_agent', 400)
    }

    const botTokenInput = typeof body.botToken === 'string' ? body.botToken.trim() : ''
    const appTokenInput = typeof body.appToken === 'string' ? body.appToken.trim() : ''

    if (botTokenInput && !isSlackBotToken(botTokenInput)) {
      return toErrorResponse('invalid_bot_token', 400, 'Bot token must start with xoxb-.')
    }
    if (appTokenInput && !isSlackAppToken(appTokenInput)) {
      return toErrorResponse('invalid_app_token', 400, 'App token must start with xapp-.')
    }

    const enabled = typeof body.enabled === 'boolean' ? body.enabled : existing?.enabled ?? false
    const reconnect = body.reconnect === true
    const tokensChanged = Boolean(botTokenInput || appTokenInput)

    if (reconnect && !enabled) {
      return toErrorResponse('cannot_reconnect_disabled', 400)
    }

    let resolvedBotToken = ''
    let resolvedAppToken = ''

    if (enabled || reconnect) {
      resolvedBotToken = botTokenInput || existing?.botTokenSecret || ''
      resolvedAppToken = appTokenInput || existing?.appTokenSecret || ''
    }

    if ((enabled || reconnect) && (!resolvedBotToken || !resolvedAppToken)) {
      if (existing?.configCorrupted) {
        return toErrorResponse('invalid_saved_tokens', 400, 'Saved Slack tokens are corrupted. Re-enter tokens and save.')
      }
      return toErrorResponse('missing_tokens', 400)
    }

    if (enabled || reconnect) {
      const serviceUser = await ensureSlackServiceUser()
      if (!serviceUser.ok) {
        return toErrorResponse(serviceUser.error, 409)
      }
    }

    let teamId = existing?.slackTeamId ?? null
    let appId = existing?.slackAppId ?? null
    let botUserId = existing?.slackBotUserId ?? null

    if (enabled || reconnect) {
      try {
        const diagnostics = await testSlackCredentials({
          appToken: resolvedAppToken,
          botToken: resolvedBotToken,
        })
        teamId = diagnostics.teamId
        appId = diagnostics.appId
        botUserId = diagnostics.botUserId
      } catch (error) {
        return toErrorResponse('slack_test_failed', 400, error instanceof Error ? error.message : 'slack_test_failed')
      }
    } else if (tokensChanged) {
      teamId = null
      appId = null
      botUserId = null
    }

    await slackService.saveIntegrationConfig({
      appTokenSecret: appTokenInput || undefined,
      botTokenSecret: botTokenInput || undefined,
      clearLastError: true,
      defaultAgentId,
      enabled,
      slackAppId: appId,
      slackBotUserId: botUserId,
      slackTeamId: teamId,
    })

    await syncSlackSocketManager(reconnect).catch(() => undefined)

    await auditEvent({
      actorUserId: user.id,
      action: 'slack_integration.updated',
      metadata: {
        defaultAgentId,
        enabled,
        reconnect,
        tokensChanged,
      },
    })

    const result = await loadSlackSettingsResponse()
    if (!result.ok) {
      return result.response
    }

    return NextResponse.json(result.response)
  },
)

export const DELETE = withAuth<SlackIntegrationMutateResponse | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireSlackIntegrationAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    await slackService.clearIntegration()
    await syncSlackSocketManager().catch(() => undefined)

    await auditEvent({
      actorUserId: user.id,
      action: 'slack_integration.deleted',
    })

    const result = await loadSlackSettingsResponse()
    if (!result.ok) {
      return result.response
    }

    return NextResponse.json(result.response)
  },
)
