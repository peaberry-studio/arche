export function normalizeWorkspacePath(rawPath: string): string {
  const normalized = rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')

  const segments = normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  return segments.join('/')
}

export function isInternalWorkspacePath(normalizedPath: string): boolean {
  const normalized = normalizeWorkspacePath(normalizedPath)
  return normalized === '.arche' || normalized.startsWith('.arche/')
}

export function isValidContextReferencePath(normalizedPath: string): boolean {
  if (!normalizedPath) return false
  if (isInternalWorkspacePath(normalizedPath)) return false

  const segments = normalizedPath.split('/')
  return segments.every((segment) => segment !== '..')
}

export function normalizeAttachmentPath(rawPath: string): string {
  return normalizeWorkspacePath(rawPath)
}
