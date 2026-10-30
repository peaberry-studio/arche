import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getStartTimeoutMs } from '@/lib/spawner/config'
import { ensureUserDirectory, getUserDataHostPath } from '@/lib/user-data'

const PROGRESS_FILE = 'legacy-history-migration.json'

export async function isHistoryMigrationInProgress(slug: string): Promise<boolean> {
  try {
    const progress: unknown = JSON.parse(await readFile(join(getUserDataHostPath(slug), PROGRESS_FILE), 'utf8'))
    return typeof progress === 'object' && progress !== null && 'startedAt' in progress &&
      typeof progress.startedAt === 'number' &&
      Date.now() - Math.max(progress.startedAt, (await stat(join(getUserDataHostPath(slug), PROGRESS_FILE))).mtimeMs) < getStartTimeoutMs() * 2
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn('[spawner] Failed to read archive progress', { slug })
    }
    return false
  }
}

export async function withHistoryMigrationProgress<T>(slug: string, work: () => Promise<T>): Promise<T> {
  const path = join(await ensureUserDirectory(slug), PROGRESS_FILE)
  const progress = JSON.stringify({ startedAt: Date.now(), attempt: randomUUID() })
  await writeFile(path, progress, { mode: 0o600 })
  let heartbeat = Promise.resolve()
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      if (await readFile(path, 'utf8') === progress) {
        const now = new Date()
        await utimes(path, now, now)
      }
    }).catch(() => { console.warn('[spawner] Failed to refresh archive progress', { slug }) })
  }, Math.max(1, getStartTimeoutMs() / 2))
  timer.unref()
  try {
    return await work()
  } finally {
    clearInterval(timer)
    await heartbeat
    try {
      if (await readFile(path, 'utf8') === progress) await unlink(path)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        console.warn('[spawner] Failed to clear archive progress', { slug })
      }
    }
  }
}
