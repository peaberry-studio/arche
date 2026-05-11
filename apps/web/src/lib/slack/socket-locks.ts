const eventExecutionLocks = new Map<string, Promise<void>>()
const threadExecutionLocks = new Map<string, Promise<void>>()

export async function withSlackThreadLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  return withLock(threadExecutionLocks, key, work)
}

export async function withSlackEventLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  return withLock(eventExecutionLocks, key, work)
}

async function withLock<T>(locks: Map<string, Promise<void>>, key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })

  locks.set(key, current)
  await previous.catch(() => undefined)

  try {
    return await work()
  } finally {
    releaseCurrent()

    if (locks.get(key) === current) {
      locks.delete(key)
    }
  }
}
