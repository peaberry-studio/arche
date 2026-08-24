import type { WorkspaceFileNode } from '@/lib/opencode/types'

export type WorkspaceFileSearchCandidate = {
  name: string
  path: string
}

export function getWorkspacePathBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function flattenWorkspaceFileNodes(nodes: WorkspaceFileNode[]): WorkspaceFileSearchCandidate[] {
  const result: WorkspaceFileSearchCandidate[] = []

  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ name: node.name, path: node.path })
      continue
    }

    if (node.children && node.children.length > 0) {
      result.push(...flattenWorkspaceFileNodes(node.children))
    }
  }

  return result
}

function fuzzyScore(value: string, token: string): number | null {
  const exactIndex = value.indexOf(token)
  if (exactIndex >= 0) return exactIndex

  let valueIndex = 0
  let previousMatchIndex = -1
  let score = 50

  for (const character of token) {
    const matchIndex = value.indexOf(character, valueIndex)
    if (matchIndex === -1) return null

    score += matchIndex
    if (previousMatchIndex >= 0 && matchIndex !== previousMatchIndex + 1) {
      score += 8
    }

    previousMatchIndex = matchIndex
    valueIndex = matchIndex + 1
  }

  return score
}

function scoreWorkspaceFileMatch(file: WorkspaceFileSearchCandidate, query: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const name = file.name.toLowerCase()
  const path = file.path.toLowerCase()
  let score = 0

  for (const token of tokens) {
    const nameScore = fuzzyScore(name, token)
    const pathScore = fuzzyScore(path, token)
    if (nameScore === null && pathScore === null) return null

    score += Math.min(
      nameScore ?? Number.POSITIVE_INFINITY,
      pathScore === null ? Number.POSITIVE_INFINITY : pathScore + 12
    )
  }

  return score + file.path.length / 1000
}

export function rankWorkspaceFileSearchCandidates({
  files,
  limit,
  query,
  remotePaths,
}: {
  files: WorkspaceFileSearchCandidate[]
  limit: number
  query: string
  remotePaths: string[]
}): WorkspaceFileSearchCandidate[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const candidatesByPath = new Map<string, WorkspaceFileSearchCandidate>()
  for (const file of files) {
    candidatesByPath.set(file.path, file)
  }
  for (const path of remotePaths) {
    if (!candidatesByPath.has(path)) {
      candidatesByPath.set(path, { name: getWorkspacePathBasename(path), path })
    }
  }

  return Array.from(candidatesByPath.values())
    .map((file) => ({ file, score: scoreWorkspaceFileMatch(file, trimmedQuery) }))
    .filter((candidate): candidate is { file: WorkspaceFileSearchCandidate; score: number } => candidate.score !== null)
    .sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map(({ file }) => file)
}

function normalizeWorkspaceLookupPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function resolveWorkspaceFilePath(
  path: string,
  availablePaths: readonly string[],
): string {
  if (!path) return path

  const available = new Set(availablePaths)
  const normalized = normalizeWorkspaceLookupPath(path)
  if (available.has(normalized)) return normalized

  const trimmed = normalized.replace(/^\/+/, '')
  if (available.has(trimmed)) return trimmed

  const matches = availablePaths.filter(
    (candidate) => normalized.endsWith(candidate) || trimmed.endsWith(candidate),
  )
  if (matches.length === 0) return normalized

  matches.sort((a, b) => b.length - a.length)
  return matches[0]
}
