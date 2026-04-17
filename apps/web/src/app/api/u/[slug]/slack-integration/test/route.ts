import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { decryptSlackToken } from '@/lib/slack/crypto'
import { isSlackAppToken, isSlackBotToken, testSlackCredentials } from '@/lib/slack/integration'
import type { SlackIntegrationTestRequest, SlackIntegrationTestResponse } from '@/lib/slack/types'
import { slackService } from '@/lib/services'

function toErrorResponse(error: string, status: number, message?: string) {
  return NextResponse.json(
    message ? { error, message } : { error },
    { status },
  )
}

function toInvalidSavedTokensResponse() {
  return toErrorResponse(
    'invalid_saved_tokens',
    400,
    'Saved Slack tokens could not be decrypted. Paste fresh credentials and try again.',
  )
}

export const POST = withAuth<SlackIntegrationTestResponse | { error: string; message?: string }>(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const denied = requireCapability('slackIntegration')
    if (denied) {
      return denied
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: SlackIntegrationTestRequest | null = null
    try {
      body = await request.json() as SlackIntegrationTestRequest
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }

      return toErrorResponse('invalid_json', 400)
    }

    const existing = await slackService.findIntegration()
    let botToken = ''
    let appToken = ''

    try {
      botToken = typeof body?.botToken === 'string' && body.botToken.trim()
        ? body.botToken.trim()
        : existing?.botTokenSecret
          ? decryptSlackToken(existing.botTokenSecret)
          : ''
      appToken = typeof body?.appToken === 'string' && body.appToken.trim()
        ? body.appToken.trim()
        : existing?.appTokenSecret
          ? decryptSlackToken(existing.appTokenSecret)
          : ''
    } catch {
      return toInvalidSavedTokensResponse()
    }

    if (!botToken || !appToken) {
      return toErrorResponse('missing_tokens', 400)
    }
    if (!isSlackBotToken(botToken)) {
      return toErrorResponse('invalid_bot_token', 400, 'Bot token must start with xoxb-.')
    }
    if (!isSlackAppToken(appToken)) {
      return toErrorResponse('invalid_app_token', 400, 'App token must start with xapp-.')
    }

    try {
      const diagnostics = await testSlackCredentials({ appToken, botToken })

      await auditEvent({
        actorUserId: user.id,
        action: 'slack_integration.connection_tested',
        metadata: diagnostics,
      })

      return NextResponse.json(diagnostics)
    } catch (error) {
      return toErrorResponse('slack_test_failed', 400, error instanceof Error ? error.message : 'slack_test_failed')
    }
  },
)
