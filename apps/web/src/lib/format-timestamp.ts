/**
 * Format a timestamp (unix ms, Date, or parseable string) for chat/session UI.
 */
export function formatTimestamp(
  timestamp: number | Date | string | undefined,
): string {
  if (!timestamp) return ''

  let date: Date
  if (typeof timestamp === 'number') {
    date = new Date(timestamp)
  } else if (typeof timestamp === 'string') {
    date = /^\d+$/.test(timestamp) ? new Date(Number(timestamp)) : new Date(timestamp)
  } else {
    date = timestamp
  }

  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}
