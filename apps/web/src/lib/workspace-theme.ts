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

export const WORKSPACE_CHAT_FONT_SIZES = [14, 15, 16, 17, 18] as const

export type WorkspaceThemeId = (typeof WORKSPACE_THEME_IDS)[number]
export type WorkspaceChatFontSize = (typeof WORKSPACE_CHAT_FONT_SIZES)[number]

export const DEFAULT_THEME_ID: WorkspaceThemeId = 'midnight-ash'
export const DEFAULT_CHAT_FONT_SIZE: WorkspaceChatFontSize = 15

const THEME_STORAGE_KEY_PREFIX = 'arche.workspace'
const THEME_COOKIE_NAME_PREFIX = 'arche-workspace-theme'
const CHAT_FONT_SIZE_COOKIE_NAME_PREFIX = 'arche-workspace-chat-font-size'
const WORKSPACE_THEME_ID_SET = new Set<string>(WORKSPACE_THEME_IDS)
const WORKSPACE_CHAT_FONT_SIZE_SET = new Set<number>(WORKSPACE_CHAT_FONT_SIZES)

export function isWorkspaceThemeId(value: string): value is WorkspaceThemeId {
  return WORKSPACE_THEME_ID_SET.has(value)
}

export function isWorkspaceChatFontSize(value: number): value is WorkspaceChatFontSize {
  return WORKSPACE_CHAT_FONT_SIZE_SET.has(value)
}

export function getWorkspaceThemeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.theme`
}

export function getWorkspaceChatFontSizeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.chat-font-size`
}

export function getWorkspaceThemeCookieName(scope: string) {
  return `${THEME_COOKIE_NAME_PREFIX}-${scope}`
}

export function getWorkspaceChatFontSizeCookieName(scope: string) {
  return `${CHAT_FONT_SIZE_COOKIE_NAME_PREFIX}-${scope}`
}
