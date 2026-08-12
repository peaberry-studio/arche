const TERMINAL_RETRY_REASONS = new Set(['free_tier_limit'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getTerminalRetryError(status: unknown): string | null {
  if (!isRecord(status) || status.type !== 'retry' || !isRecord(status.action)) {
    return null
  }

  const reason = status.action.reason
  return typeof reason === 'string' && TERMINAL_RETRY_REASONS.has(reason)
    ? reason
    : null
}
