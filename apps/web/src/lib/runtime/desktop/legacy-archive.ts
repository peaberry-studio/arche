import { spawn, type ChildProcess } from 'child_process'
import { cp, mkdtemp, rm } from 'fs/promises'
import { dirname, join } from 'path'

import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import { getLegacySessionReader } from '@/lib/harness/registry'
import { createSafeEnv, DEFAULT_USERNAME, getLegacyOpencodeBinary, LOOPBACK_HOST, makeAuthHeader } from '@/lib/runtime/desktop/config'
import { waitForProcessExit } from '@/lib/runtime/desktop/process'

const SHUTDOWN_TIMEOUT_MS = 5_000
const unconfirmedHelpers = new Map<string, { child: ChildProcess; archiveDir: string }>()

async function stopArchiveHelper(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (!await waitForProcessExit(child, SHUTDOWN_TIMEOUT_MS)) {
    child.kill('SIGKILL')
    if (!await waitForProcessExit(child, SHUTDOWN_TIMEOUT_MS)) throw new Error('desktop_legacy_archive_cleanup_unconfirmed')
  }
}

export async function cleanupDesktopLegacyArchive(dataDir: string): Promise<void> {
  const helper = unconfirmedHelpers.get(dataDir)
  if (!helper) return
  await stopArchiveHelper(helper.child)
  await rm(helper.archiveDir, { recursive: true, force: true })
  unconfirmedHelpers.delete(dataDir)
}

export async function archiveDesktopLegacySessions(input: {
  slug: string
  workspaceDir: string
  dataDir: string
  port: number
  password: string
  timeoutMs: number
  intervalMs: number
}): Promise<HarnessResult<{ archived: number }>> {
  await cleanupDesktopLegacyArchive(input.dataDir)
  const archiveDir = await mkdtemp(join(dirname(input.dataDir), '.opencode-archive-'))
  let child: ChildProcess | undefined
  let spawnError = false
  try {
    await cp(join(input.dataDir, '.local'), join(archiveDir, '.local'), { recursive: true, dereference: true })
    child = spawn(getLegacyOpencodeBinary(), ['serve', '--hostname', LOOPBACK_HOST, '--port', String(input.port)], {
      cwd: input.workspaceDir,
      env: {
        ...createSafeEnv(),
        HOME: archiveDir,
        XDG_DATA_HOME: join(archiveDir, '.local', 'share'),
        XDG_STATE_HOME: join(archiveDir, '.local', 'state'),
        XDG_CONFIG_HOME: join(archiveDir, 'config'),
        OPENCODE_SERVER_USERNAME: DEFAULT_USERNAME,
        OPENCODE_SERVER_PASSWORD: input.password,
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
        OPENCODE_DISABLE_MODELS_FETCH: 'true',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {}, plugin: [], enabled_providers: [] }),
      },
      stdio: 'ignore',
      detached: false,
    })
    child.on('error', () => { spawnError = true })
    const signal = AbortSignal.timeout(input.timeoutMs)
    const reader = getLegacySessionReader(input.slug, {
      baseUrl: `http://${LOOPBACK_HOST}:${input.port}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, input.password),
    })
    while (!signal.aborted && !spawnError && child.exitCode === null && child.signalCode === null) {
      const health = await reader.health({ signal, timeoutMs: Math.min(3_000, input.timeoutMs) })
      if (health.ok) return await exportLegacySessions(input.slug, reader)
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
    }
    return harnessFailure('runtime_error', 'desktop_legacy_archive_unavailable')
  } catch (error) {
    return harnessFailure('runtime_error', error instanceof Error ? error.message : String(error))
  } finally {
    if (child && (!spawnError || child.pid !== undefined)) {
      try {
        await stopArchiveHelper(child)
      } catch (error) {
        unconfirmedHelpers.set(input.dataDir, { child, archiveDir })
        throw error
      }
    }
    await rm(archiveDir, { recursive: true, force: true })
  }
}
