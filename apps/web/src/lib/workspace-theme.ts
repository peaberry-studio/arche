export const WORKSPACE_THEME_IDS = [
  'warm-sand',
  'ocean-mist',
  'forest-dew',
  'lavender-haze',
  'sunset-glow',
  'midnight-ember',
  'midnight-ash',
  'nuclear',
] as const

export type WorkspaceThemeId = (typeof WORKSPACE_THEME_IDS)[number]

export const DEFAULT_THEME_ID: WorkspaceThemeId = 'midnight-ash'

const THEME_STORAGE_KEY_PREFIX = 'arche.workspace'
const THEME_COOKIE_NAME_PREFIX = 'arche-workspace-theme'
const WORKSPACE_THEME_ID_SET = new Set<string>(WORKSPACE_THEME_IDS)

export function isWorkspaceThemeId(value: string): value is WorkspaceThemeId {
  return WORKSPACE_THEME_ID_SET.has(value)
}

export function getWorkspaceThemeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.theme`
}

export function getWorkspaceThemeCookieName(scope: string) {
  return `${THEME_COOKIE_NAME_PREFIX}-${scope}`
}
