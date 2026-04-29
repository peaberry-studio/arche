type WorkspaceStartPromptStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type WorkspaceStartPrompt = {
  text: string
  contextPaths: string[]
}

type WorkspaceStartPromptInput =
  | string
  | {
      text: string
      contextPaths?: string[]
    }

type StoredWorkspaceStartPrompt = {
  version: 1
  text: string
  contextPaths: string[]
}

const WORKSPACE_START_PROMPT_KEY_PREFIX = 'arche.workspaceStartPrompt.v1:'

function getWorkspaceStartPromptKey(slug: string) {
  return WORKSPACE_START_PROMPT_KEY_PREFIX + slug
}

function normalizeContextPaths(paths: string[] | undefined): string[] {
  if (!paths) return []

  const unique = new Set<string>()
  const normalized: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed || unique.has(trimmed)) continue

    unique.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

function normalizePrompt(prompt: WorkspaceStartPromptInput): WorkspaceStartPrompt | null {
  const text = typeof prompt === 'string' ? prompt.trim() : prompt.text.trim()
  if (!text) return null

  return {
    text,
    contextPaths: typeof prompt === 'string' ? [] : normalizeContextPaths(prompt.contextPaths),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseStoredPrompt(value: string): WorkspaceStartPrompt | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return { text: trimmed, contextPaths: [] }

    if (parsed.version !== 1 || typeof parsed.text !== 'string') {
      return { text: trimmed, contextPaths: [] }
    }

    const text = parsed.text.trim()
    if (!text) return null

    return {
      text,
      contextPaths: Array.isArray(parsed.contextPaths)
        ? normalizeContextPaths(parsed.contextPaths.filter((path): path is string => typeof path === 'string'))
        : [],
    }
  } catch {
    return { text: trimmed, contextPaths: [] }
  }
}

export function setWorkspaceStartPrompt(
  storage: WorkspaceStartPromptStorage,
  slug: string,
  prompt: WorkspaceStartPromptInput
): boolean {
  const normalized = normalizePrompt(prompt)
  if (!normalized) return false

  const stored: StoredWorkspaceStartPrompt = {
    version: 1,
    text: normalized.text,
    contextPaths: normalized.contextPaths,
  }

  storage.setItem(getWorkspaceStartPromptKey(slug), JSON.stringify(stored))
  return true
}

export function takeWorkspaceStartPrompt(
  storage: WorkspaceStartPromptStorage,
  slug: string
): WorkspaceStartPrompt | null {
  const key = getWorkspaceStartPromptKey(slug)
  const value = storage.getItem(key)
  if (!value) return null

  storage.removeItem(key)

  return parseStoredPrompt(value)
}
