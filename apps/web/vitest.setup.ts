type StorageLike = {
  clear: () => void
  getItem: (key: string) => string | null
  key: (index: number) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
  readonly length: number
}

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()

  return {
    clear() {
      values.clear()
    },
    get length() {
      return values.size
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key) ?? null : null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, String(value))
    },
  }
}

function ensureWorkingStorage(name: 'localStorage' | 'sessionStorage') {
  const current = globalThis[name]
  if (
    current &&
    typeof current.getItem === 'function' &&
    typeof current.setItem === 'function' &&
    typeof current.clear === 'function'
  ) {
    return
  }

  const replacement = createMemoryStorage()

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: replacement,
    writable: true,
  })

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      configurable: true,
      value: replacement,
      writable: true,
    })
  }
}

ensureWorkingStorage('localStorage')
ensureWorkingStorage('sessionStorage')
