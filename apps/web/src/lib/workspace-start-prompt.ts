type WorkspaceStartPromptStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const WORKSPACE_START_PROMPT_KEY_PREFIX = 'arche.workspaceStartPrompt.v1:'

function getWorkspaceStartPromptKey(slug: string) {
  return WORKSPACE_START_PROMPT_KEY_PREFIX + slug
}

export function setWorkspaceStartPrompt(
  storage: WorkspaceStartPromptStorage,
  slug: string,
  prompt: string
): boolean {
  const trimmed = prompt.trim()
  if (!trimmed) return false

  storage.setItem(getWorkspaceStartPromptKey(slug), trimmed)
  return true
}

export function takeWorkspaceStartPrompt(
  storage: WorkspaceStartPromptStorage,
  slug: string
): string | null {
  const key = getWorkspaceStartPromptKey(slug)
  const value = storage.getItem(key)
  if (!value) return null

  storage.removeItem(key)

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
