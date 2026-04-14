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

  if ('cronExpression' in value && !('timezone' in value) && !options.fallbackTimezone) {
    return { ok: false, error: 'invalid_timezone', status: 400 }
  }

  return { ok: true, value }
}
