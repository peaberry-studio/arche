export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

export function parseNonEmptyString(
  value: unknown,
  fieldName: string,
  fileName: string
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${fieldName} in ${fileName}`)
  }

  return value.trim()
}

export function parseOrder(value: unknown, fileName: string): number {
  if (value === undefined) {
    return 1000
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid order in ${fileName}`)
  }

  return value
}

export function normalizeRepoPath(rawPath: string): string | null {
  const normalized = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/g, '')

  if (!normalized) return null

  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    return null
  }

  return normalized
}
