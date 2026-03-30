import { vi } from 'vitest'

export function createStorageMock(): Storage {
  let store: Record<string, string> = {}

  return {
    get length() {
      return Object.keys(store).length
    },
    clear() {
      store = {}
    },
    getItem(key: string) {
      return key in store ? store[key] : null
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    removeItem(key: string) {
      delete store[key]
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
  }
}

export function stubBrowserStorage() {
  const localStorage = createStorageMock()
  const sessionStorage = createStorageMock()

  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('sessionStorage', sessionStorage)

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorage,
    })
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: sessionStorage,
    })
  }

  return { localStorage, sessionStorage }
}
