/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  getWorkspaceLayoutCookieName,
  getWorkspaceLayoutStorageKey,
  persistWorkspacePanelState,
  readWorkspacePanelState,
} from '@/lib/workspace-panel-state'

function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const [name] = cookie.trim().split('=')
    if (!name) return

    document.cookie = `${name}=; Path=/; Max-Age=0`
  })
}

function readCookieValue(cookieName: string): string | null {
  const prefix = `${cookieName}=`

  for (const cookie of document.cookie.split(';')) {
    const trimmedCookie = cookie.trim()
    if (!trimmedCookie.startsWith(prefix)) continue
    return decodeURIComponent(trimmedCookie.slice(prefix.length))
  }

  return null
}

function parseJsonValue<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

describe('workspace panel state persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearCookies()
  })

  it('reads the localStorage value when present', () => {
    const storageKey = getWorkspaceLayoutStorageKey('alice')
    const cookieName = getWorkspaceLayoutCookieName('alice')

    window.localStorage.setItem(storageKey, JSON.stringify({ leftCollapsed: true }))
    document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify({ leftCollapsed: false }))}; Path=/`

    const result = readWorkspacePanelState(storageKey, cookieName, parseJsonValue<{ leftCollapsed: boolean }>)

    expect(result).toEqual({ leftCollapsed: true })
  })

  it('falls back to the cookie value and restores localStorage', () => {
    const storageKey = getWorkspaceLayoutStorageKey('alice')
    const cookieName = getWorkspaceLayoutCookieName('alice')

    document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify({ rightCollapsed: true }))}; Path=/`

    const result = readWorkspacePanelState(storageKey, cookieName, parseJsonValue<{ rightCollapsed: boolean }>)

    expect(result).toEqual({ rightCollapsed: true })
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify({ rightCollapsed: true }))
  })

  it('persists the value to both localStorage and cookies', () => {
    const storageKey = getWorkspaceLayoutStorageKey('alice')
    const cookieName = getWorkspaceLayoutCookieName('alice')
    const state = { leftWidth: 264, rightWidth: 418, rightCollapsed: true }

    persistWorkspacePanelState(storageKey, cookieName, state)

    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify(state))
    expect(readCookieValue(cookieName)).toBe(JSON.stringify(state))
  })
})
