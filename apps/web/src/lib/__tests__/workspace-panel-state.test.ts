/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubBrowserStorage } from '@/__tests__/storage'
import {
  getWorkspaceLayoutCookieName,
  getWorkspaceLayoutStorageKey,
  normalizeLeftPanelState,
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
    stubBrowserStorage()
    window.localStorage.clear()
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('normalizes the new left panel state structure', () => {
    expect(
      normalizeLeftPanelState({
        ratios: {
          chats: 0.5,
          knowledge: 0.25,
          experts: 0.15,
          skills: 0.1,
        },
        collapsed: {
          chats: true,
          skills: true,
        },
      })
    ).toEqual({
      ratios: {
        chats: 0.5,
        knowledge: 0.25,
        experts: 0.15,
        skills: 0.1,
      },
      collapsed: {
        chats: true,
        knowledge: false,
        experts: false,
        skills: true,
      },
    })
  })

  it('migrates the legacy three-section state into the new shape', () => {
    const migrated = normalizeLeftPanelState({
      topRatio: 0.4,
      midRatio: 0.3,
      topCollapsed: true,
      midCollapsed: false,
      bottomCollapsed: true,
    })

    expect(migrated.collapsed).toEqual({
      chats: true,
      knowledge: false,
      experts: true,
      skills: true,
    })
    expect(migrated.ratios.chats).toBeCloseTo(0.4)
    expect(migrated.ratios.knowledge).toBeCloseTo(0.3)
    expect(migrated.ratios.experts).toBeCloseTo(0.15)
    expect(migrated.ratios.skills).toBeCloseTo(0.15)
  })
})
