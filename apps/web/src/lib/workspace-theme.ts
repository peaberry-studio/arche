export const WORKSPACE_THEME_IDS = [
  'warm-sand',
  'ocean-mist',
  'forest-dew',
  'lavender-haze',
  'sunset-glow',
] as const

export const WORKSPACE_CHAT_FONT_SIZES = [14, 15, 16, 17, 18] as const
export const WORKSPACE_CHAT_FONT_FAMILIES = ['sans', 'serif'] as const

export type WorkspaceThemeId = (typeof WORKSPACE_THEME_IDS)[number]
export type WorkspaceChatFontSize = (typeof WORKSPACE_CHAT_FONT_SIZES)[number]
export type WorkspaceChatFontFamily = (typeof WORKSPACE_CHAT_FONT_FAMILIES)[number]

export const DEFAULT_THEME_ID: WorkspaceThemeId = 'warm-sand'
export const DEFAULT_DARK_MODE = false
export const DEFAULT_CHAT_FONT_SIZE: WorkspaceChatFontSize = 15
export const DEFAULT_CHAT_FONT_FAMILY: WorkspaceChatFontFamily = 'sans'

const THEME_STORAGE_KEY_PREFIX = 'arche.workspace'
const THEME_COOKIE_NAME_PREFIX = 'arche-workspace-theme'
const DARK_MODE_COOKIE_NAME_PREFIX = 'arche-workspace-dark-mode'
const CHAT_FONT_SIZE_COOKIE_NAME_PREFIX = 'arche-workspace-chat-font-size'
const CHAT_FONT_FAMILY_COOKIE_NAME_PREFIX = 'arche-workspace-chat-font-family'
const WORKSPACE_THEME_ID_SET = new Set<string>(WORKSPACE_THEME_IDS)
const WORKSPACE_CHAT_FONT_SIZE_SET = new Set<number>(WORKSPACE_CHAT_FONT_SIZES)
const WORKSPACE_CHAT_FONT_FAMILY_SET = new Set<string>(WORKSPACE_CHAT_FONT_FAMILIES)

export function isWorkspaceThemeId(value: string): value is WorkspaceThemeId {
  return WORKSPACE_THEME_ID_SET.has(value)
}

export function isWorkspaceChatFontSize(value: number): value is WorkspaceChatFontSize {
  return WORKSPACE_CHAT_FONT_SIZE_SET.has(value)
}

export function isWorkspaceChatFontFamily(value: string): value is WorkspaceChatFontFamily {
  return WORKSPACE_CHAT_FONT_FAMILY_SET.has(value)
}

export function getWorkspaceThemeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.theme`
}

export function getWorkspaceDarkModeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.dark-mode`
}

export function getWorkspaceChatFontSizeStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.chat-font-size`
}

export function getWorkspaceChatFontFamilyStorageKey(scope: string) {
  return `${THEME_STORAGE_KEY_PREFIX}.${scope}.chat-font-family`
}

export function getWorkspaceThemeCookieName(scope: string) {
  return `${THEME_COOKIE_NAME_PREFIX}-${scope}`
}

export function getWorkspaceDarkModeCookieName(scope: string) {
  return `${DARK_MODE_COOKIE_NAME_PREFIX}-${scope}`
}

export function getWorkspaceChatFontSizeCookieName(scope: string) {
  return `${CHAT_FONT_SIZE_COOKIE_NAME_PREFIX}-${scope}`
}

export function getWorkspaceChatFontFamilyCookieName(scope: string) {
  return `${CHAT_FONT_FAMILY_COOKIE_NAME_PREFIX}-${scope}`
}
