const STORAGE_KEY_PREFIX = 'arche.workspace'
const LAYOUT_COOKIE_NAME_PREFIX = 'arche-workspace-layout'
const LEFT_PANEL_COOKIE_NAME_PREFIX = 'arche-workspace-left-panel'
const COOKIE_MAX_AGE_SECONDS = 31536000

export type StoredLayoutState = {
  leftWidth?: number
  rightWidth?: number
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  rightTab?: 'preview' | 'review'
}

export type StoredLeftPanelState = {
  topRatio?: number
  midRatio?: number
  topCollapsed?: boolean
  midCollapsed?: boolean
  bottomCollapsed?: boolean
}

export type NormalizedLeftPanelState = {
  topRatio: number
  midRatio: number
  topCollapsed: boolean
  midCollapsed: boolean
  bottomCollapsed: boolean
}

const DEFAULT_TOP_RATIO = 3 / 8
const DEFAULT_MID_RATIO = 3 / 8

export const DEFAULT_LEFT_PANEL_STATE: NormalizedLeftPanelState = {
  topRatio: DEFAULT_TOP_RATIO,
  midRatio: DEFAULT_MID_RATIO,
  topCollapsed: false,
  midCollapsed: false,
  bottomCollapsed: false,
}

function isValidRatio(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value > 0 && value < 1
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

  return {
    topRatio: isValidRatio(state.topRatio) ? state.topRatio : DEFAULT_TOP_RATIO,
    midRatio: isValidRatio(state.midRatio) ? state.midRatio : DEFAULT_MID_RATIO,
    topCollapsed: typeof state.topCollapsed === 'boolean' ? state.topCollapsed : false,
    midCollapsed: typeof state.midCollapsed === 'boolean' ? state.midCollapsed : false,
    bottomCollapsed: typeof state.bottomCollapsed === 'boolean' ? state.bottomCollapsed : false,
  }
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
