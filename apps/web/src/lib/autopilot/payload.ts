import { listAutopilotAgentOptions } from '@/lib/autopilot/agents'
import { assertValidAutopilotTimeZone, validateAutopilotCronExpression } from '@/lib/autopilot/cron'
import type { AutopilotTaskPayload } from '@/lib/autopilot/types'

type PayloadMode = 'create' | 'update'

type PayloadValidationResult =
  | { ok: true; value: Partial<AutopilotTaskPayload> }
  | { ok: false; error: string; status: number }

type PayloadValidationOptions = {
  fallbackTimezone?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export async function validateAutopilotTaskPayload(
  body: unknown,
  mode: PayloadMode,
  options: PayloadValidationOptions = {},
): Promise<PayloadValidationResult> {
  const record = asRecord(body)
  if (!record) {
    return { ok: false, error: 'invalid_body', status: 400 }
  }

  const value: Partial<AutopilotTaskPayload> = {}

  if (mode === 'create' || 'name' in record) {
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) {
      return { ok: false, error: 'invalid_name', status: 400 }
    }

    value.name = name
  }

  if (mode === 'create' || 'prompt' in record) {
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (!prompt) {
      return { ok: false, error: 'invalid_prompt', status: 400 }
    }

    value.prompt = prompt
  }

  if (mode === 'create' || 'timezone' in record) {
    if (typeof record.timezone !== 'string') {
      return { ok: false, error: 'invalid_timezone', status: 400 }
    }

    try {
      value.timezone = assertValidAutopilotTimeZone(record.timezone)
    } catch {
      return { ok: false, error: 'invalid_timezone', status: 400 }
    }
  }

  if (mode === 'create' || 'cronExpression' in record) {
    if (typeof record.cronExpression !== 'string') {
      return { ok: false, error: 'invalid_cron_expression', status: 400 }
    }

    const timezone =
      typeof record.timezone === 'string'
        ? record.timezone
        : value.timezone ?? options.fallbackTimezone ?? null
    if (!timezone) {
      return { ok: false, error: 'invalid_timezone', status: 400 }
    }

    try {
      value.cronExpression = validateAutopilotCronExpression(record.cronExpression, timezone)
    } catch {
      return { ok: false, error: 'invalid_cron_expression', status: 400 }
    }
  }

  if ('targetAgentId' in record || mode === 'create') {
    const rawTargetAgentId = record.targetAgentId
    const targetAgentId =
      rawTargetAgentId === null || rawTargetAgentId === undefined
        ? null
        : typeof rawTargetAgentId === 'string' && rawTargetAgentId.trim().length > 0
          ? rawTargetAgentId.trim()
          : '__invalid__'

    if (targetAgentId === '__invalid__') {
      return { ok: false, error: 'invalid_target_agent', status: 400 }
    }

    if (targetAgentId) {
      const agentsResult = await listAutopilotAgentOptions()
      if (!agentsResult.ok) {
        return {
          ok: false,
          error: agentsResult.error,
          status: agentsResult.error === 'kb_unavailable' ? 503 : 500,
        }
      }

      if (!agentsResult.agents.some((agent) => agent.id === targetAgentId)) {
        return { ok: false, error: 'unknown_target_agent', status: 400 }
      }
    }

    value.targetAgentId = targetAgentId
  }

  if (mode === 'create' || 'enabled' in record) {
    if (typeof record.enabled !== 'boolean') {
      return { ok: false, error: 'invalid_enabled', status: 400 }
    }

    value.enabled = record.enabled
  }

  if ('slackNotificationConfig' in record) {
    if (record.slackNotificationConfig === null) {
      value.slackNotificationConfig = null
      return { ok: true, value }
    }

    const config = asRecord(record.slackNotificationConfig)
    if (!config) {
      return { ok: false, error: 'invalid_slack_notification_config', status: 400 }
    }

    const enabled = typeof config.enabled === 'boolean' ? config.enabled : false
    const includeSessionLink = typeof config.includeSessionLink === 'boolean' ? config.includeSessionLink : true
    const targetsRaw = Array.isArray(config.targets) ? config.targets : []
    const targets: NonNullable<AutopilotTaskPayload['slackNotificationConfig']>['targets'] = []

    for (const targetRaw of targetsRaw) {
      const target = asRecord(targetRaw)
      if (!target) {
        return { ok: false, error: 'invalid_slack_notification_target', status: 400 }
      }

      if (target.type === 'dm') {
        const userId = typeof target.userId === 'string' ? target.userId.trim() : ''
        if (!userId) {
          return { ok: false, error: 'invalid_slack_notification_dm_target', status: 400 }
        }
        targets.push({ type: 'dm', userId })
        continue
      }

      if (target.type === 'channel') {
        const channelId = typeof target.channelId === 'string' ? target.channelId.trim() : ''
        if (!channelId) {
          return { ok: false, error: 'invalid_slack_notification_channel_target', status: 400 }
        }
        targets.push({ type: 'channel', channelId })
        continue
      }

      return { ok: false, error: 'invalid_slack_notification_target_type', status: 400 }
    }

    if (enabled && targets.length === 0) {
      return { ok: false, error: 'slack_notification_targets_required', status: 400 }
    }

    value.slackNotificationConfig = {
      enabled,
      includeSessionLink,
      targets,
    }
  }

  if ('cronExpression' in value && !('timezone' in value) && !options.fallbackTimezone) {
    return { ok: false, error: 'invalid_timezone', status: 400 }
  }

  return { ok: true, value }
}
