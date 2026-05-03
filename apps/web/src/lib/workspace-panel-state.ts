const STORAGE_KEY_PREFIX = 'arche.workspace'
const LAYOUT_COOKIE_NAME_PREFIX = 'arche-workspace-layout'
const LEFT_PANEL_COOKIE_NAME_PREFIX = 'arche-workspace-left-panel'
const COOKIE_MAX_AGE_SECONDS = 31536000

export const LEFT_PANEL_SECTION_IDS = ['chats', 'knowledge', 'experts', 'skills'] as const

export type LeftPanelSectionId = (typeof LEFT_PANEL_SECTION_IDS)[number]

export type StoredLayoutState = {
  leftWidth?: number
  rightWidth?: number
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  leftCollapsedByMode?: Record<string, boolean>
  rightCollapsedByMode?: Record<string, boolean>
  leftWidthByMode?: Record<string, number>
  rightWidthByMode?: Record<string, number>
  rightTab?: 'preview' | 'review'
}

type LegacyStoredLeftPanelState = {
  bottomCollapsed?: boolean
  midCollapsed?: boolean
  midRatio?: number
  topCollapsed?: boolean
  topRatio?: number
}

export type StoredLeftPanelState = {
  collapsed?: Partial<Record<LeftPanelSectionId, boolean>>
  ratios?: Partial<Record<LeftPanelSectionId, number>>
} & LegacyStoredLeftPanelState

export type NormalizedLeftPanelState = {
  collapsed: Record<LeftPanelSectionId, boolean>
  ratios: Record<LeftPanelSectionId, number>
}

const DEFAULT_LEFT_PANEL_RATIOS: Record<LeftPanelSectionId, number> = {
  chats: 0.32,
  knowledge: 0.32,
  experts: 0.18,
  skills: 0.18,
}

const DEFAULT_LEFT_PANEL_COLLAPSED: Record<LeftPanelSectionId, boolean> = {
  chats: false,
  knowledge: false,
  experts: false,
  skills: false,
}

export const DEFAULT_LEFT_PANEL_STATE: NormalizedLeftPanelState = {
  ratios: DEFAULT_LEFT_PANEL_RATIOS,
  collapsed: DEFAULT_LEFT_PANEL_COLLAPSED,
}

function isValidRatio(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value > 0 && value < 1
}

function isSectionId(value: string): value is LeftPanelSectionId {
  return LEFT_PANEL_SECTION_IDS.includes(value as LeftPanelSectionId)
}

function normalizeRatios(partial: Partial<Record<LeftPanelSectionId, number>>): Record<LeftPanelSectionId, number> {
  const rawRatios = Object.fromEntries(
    LEFT_PANEL_SECTION_IDS.map((sectionId) => [
      sectionId,
      isValidRatio(partial[sectionId]) ? partial[sectionId] : DEFAULT_LEFT_PANEL_RATIOS[sectionId],
    ])
  ) as Record<LeftPanelSectionId, number>

  const total = Object.values(rawRatios).reduce((sum, value) => sum + value, 0)
  if (!isFinite(total) || total <= 0) {
    return { ...DEFAULT_LEFT_PANEL_RATIOS }
  }

  return Object.fromEntries(
    LEFT_PANEL_SECTION_IDS.map((sectionId) => [sectionId, rawRatios[sectionId] / total])
  ) as Record<LeftPanelSectionId, number>
}

function normalizeCollapsed(partial: Partial<Record<LeftPanelSectionId, boolean>>): Record<LeftPanelSectionId, boolean> {
  return Object.fromEntries(
    LEFT_PANEL_SECTION_IDS.map((sectionId) => [
      sectionId,
      typeof partial[sectionId] === 'boolean' ? partial[sectionId] : DEFAULT_LEFT_PANEL_COLLAPSED[sectionId],
    ])
  ) as Record<LeftPanelSectionId, boolean>
}

function readLocalStorageValue(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeLocalStorageValue(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    // ignore storage errors
  }
}

function readCookieValue(cookieName: string): string | null {
  if (typeof document === 'undefined') return null

  const prefix = `${cookieName}=`

  for (const cookie of document.cookie.split(';')) {
    const trimmedCookie = cookie.trim()
    if (!trimmedCookie.startsWith(prefix)) continue

    try {
      return decodeURIComponent(trimmedCookie.slice(prefix.length))
    } catch {
      return null
    }
  }

  return null
}

function writeCookieValue(cookieName: string, value: string): void {
  if (typeof document === 'undefined') return

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${cookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

function normalizeLegacyState(state: LegacyStoredLeftPanelState): NormalizedLeftPanelState {
  const topRatio = isValidRatio(state.topRatio) ? state.topRatio : DEFAULT_LEFT_PANEL_RATIOS.chats
  const midRatio = isValidRatio(state.midRatio) ? state.midRatio : DEFAULT_LEFT_PANEL_RATIOS.knowledge
  const bottomShare = Math.max(0.1, 1 - topRatio - midRatio) / 2

  return {
    ratios: normalizeRatios({
      chats: topRatio,
      knowledge: midRatio,
      experts: bottomShare,
      skills: bottomShare,
    }),
    collapsed: normalizeCollapsed({
      chats: typeof state.topCollapsed === 'boolean' ? state.topCollapsed : false,
      knowledge: typeof state.midCollapsed === 'boolean' ? state.midCollapsed : false,
      experts: typeof state.bottomCollapsed === 'boolean' ? state.bottomCollapsed : false,
      skills: typeof state.bottomCollapsed === 'boolean' ? state.bottomCollapsed : false,
    }),
  }
}

export function getWorkspaceLayoutStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}.${scope}.layout`
}

export function getWorkspaceLayoutCookieName(scope: string): string {
  return `${LAYOUT_COOKIE_NAME_PREFIX}-${scope}`
}

export function getWorkspaceLeftPanelStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}.${scope}.left-panel`
}

export function getWorkspaceLeftPanelCookieName(scope: string): string {
  return `${LEFT_PANEL_COOKIE_NAME_PREFIX}-${scope}`
}

export function parseWorkspaceLayoutState(value: string): StoredLayoutState | null {
  try {
    return JSON.parse(value) as StoredLayoutState
  } catch {
    return null
  }
}

export function parseStoredLeftPanelState(value: string): StoredLeftPanelState | null {
  try {
    return JSON.parse(value) as StoredLeftPanelState
  } catch {
    return null
  }
}

export function normalizeLeftPanelState(
  state: StoredLeftPanelState | NormalizedLeftPanelState | null | undefined,
): NormalizedLeftPanelState {
  if (!state) return DEFAULT_LEFT_PANEL_STATE

  if ('ratios' in state || 'collapsed' in state) {
    const ratios = state.ratios && typeof state.ratios === 'object' && !Array.isArray(state.ratios)
      ? Object.fromEntries(
          Object.entries(state.ratios).filter(([key]) => isSectionId(key))
        ) as Partial<Record<LeftPanelSectionId, number>>
      : {}
    const collapsed = state.collapsed && typeof state.collapsed === 'object' && !Array.isArray(state.collapsed)
      ? Object.fromEntries(
          Object.entries(state.collapsed).filter(([key]) => isSectionId(key))
        ) as Partial<Record<LeftPanelSectionId, boolean>>
      : {}

    return {
      ratios: normalizeRatios(ratios),
      collapsed: normalizeCollapsed(collapsed),
    }
  }

  return normalizeLegacyState(state)
}

export function readWorkspacePanelState<T>(
  storageKey: string,
  cookieName: string,
  parse: (value: string) => T | null,
): T | null {
  if (typeof window === 'undefined') return null

  const storedValue = readLocalStorageValue(storageKey)
  if (storedValue) {
    const parsedStoredValue = parse(storedValue)
    if (parsedStoredValue) {
      return parsedStoredValue
    }
  }

  const cookieValue = readCookieValue(cookieName)
  if (!cookieValue) return null

  const parsedCookieValue = parse(cookieValue)
  if (!parsedCookieValue) return null

  writeLocalStorageValue(storageKey, cookieValue)
  return parsedCookieValue
}

export function persistWorkspacePanelState<T>(
  storageKey: string,
  cookieName: string,
  value: T,
): void {
  if (typeof window === 'undefined') return

  const serializedValue = JSON.stringify(value)
  writeLocalStorageValue(storageKey, serializedValue)
  writeCookieValue(cookieName, serializedValue)
}
