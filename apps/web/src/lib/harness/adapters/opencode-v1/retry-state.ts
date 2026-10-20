import { isRecord } from '@/lib/records'

const TERMINAL_RETRY_REASONS = new Set(['free_tier_limit'])

export function getTerminalRetryError(status: unknown): string | null {
  if (!isRecord(status) || status.type !== 'retry' || !isRecord(status.action)) {
    return null
  }

  const reason = status.action.reason
  return typeof reason === 'string' && TERMINAL_RETRY_REASONS.has(reason)
    ? reason
    : null
}
