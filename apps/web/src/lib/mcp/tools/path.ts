import path from 'node:path'

export function normalizeKbPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/')
  if (normalizedSlashes.includes('\0') || normalizedSlashes.startsWith('/')) {
    return null
  }

  if (normalizedSlashes.split('/').includes('..')) {
    return null
  }

  const normalized = path.posix.normalize(normalizedSlashes).replace(/^\.\/+/, '')
  if (!normalized || normalized === '.' || normalized === '..') {
    return null
  }

  return normalized.replace(/\/+$/, '')
}

export function isPathSafe(value: string): boolean {
  return normalizeKbPath(value) !== null
}
