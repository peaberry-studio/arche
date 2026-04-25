import path from 'node:path'

const GIT_CONTROL_FILES = new Set([
  '.gitmodules',
  '.gitignore',
  '.gitattributes',
])

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export function normalizeKbPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  if (CONTROL_CHARACTER_PATTERN.test(normalizedSlashes) || normalizedSlashes.startsWith('/')) {
    return null
  }

  const segments = normalizedSlashes.split('/')
  if (segments.some((segment) => isUnsafeSegment(segment))) {
    return null
  }

  const normalized = path.posix.normalize(normalizedSlashes)
  if (!normalized || normalized === '.' || normalized === '..') {
    return null
  }

  return normalized
}

export function isPathSafe(value: string): boolean {
  return normalizeKbPath(value) !== null
}

export function normalizeKbWritePath(value: string): string | null {
  const normalizedSlashes = value.trim().replace(/\\/g, '/')
  if (normalizedSlashes.endsWith('/')) {
    return null
  }

  return normalizeKbPath(value)
}

function isUnsafeSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment === '.git' ||
    GIT_CONTROL_FILES.has(segment)
  )
}
