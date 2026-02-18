const PROTECTED_WORKSPACE_ROOT_FILES = new Set([
  '.gitignore',
  '.gitkeep',
  'opencode.json',
  'agents.md',
])

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

function splitPathSegments(path: string): string[] {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized) return []
  return normalized.split('/')
}

function isRootProtectedWorkspaceFile(path: string): boolean {
  const segments = splitPathSegments(path)
  if (segments.length !== 1) return false

  return PROTECTED_WORKSPACE_ROOT_FILES.has(segments[0].toLowerCase())
}

export function isNodeModulesWorkspacePath(path: string): boolean {
  const segments = splitPathSegments(path)
  return segments.some((segment) => segment.toLowerCase() === 'node_modules')
}

function isGitkeepWorkspacePath(path: string): boolean {
  const segments = splitPathSegments(path)
  return segments.some((segment) => segment.toLowerCase() === '.gitkeep')
}

export function isProtectedWorkspacePath(path: string): boolean {
  return (
    isRootProtectedWorkspaceFile(path) ||
    isNodeModulesWorkspacePath(path) ||
    isGitkeepWorkspacePath(path)
  )
}

export function isHiddenWorkspacePath(path: string): boolean {
  return isInternalWorkspacePath(path) || isProtectedWorkspacePath(path)
}

export function isValidContextReferencePath(normalizedPath: string): boolean {
  if (!normalizedPath) return false
  if (isHiddenWorkspacePath(normalizedPath)) return false

  const segments = normalizedPath.split('/')
  return segments.every((segment) => segment !== '..')
}

export function normalizeAttachmentPath(rawPath: string): string {
  return normalizeWorkspacePath(rawPath)
}
