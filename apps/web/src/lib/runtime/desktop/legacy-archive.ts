import { spawn, type ChildProcess } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'

import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import { getRuntimeForKind } from '@/lib/harness/registry'
import { createSafeEnv, DEFAULT_USERNAME, getOpencodeBinary, LOOPBACK_HOST, makeAuthHeader } from '@/lib/runtime/desktop/config'
import { waitForProcessExit } from '@/lib/runtime/desktop/process'

const SHUTDOWN_TIMEOUT_MS = 5_000
const unconfirmedHelpers = new Map<string, { child: ChildProcess; configDir: string }>()

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
  await rm(helper.configDir, { recursive: true, force: true })
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
  const configDir = await mkdtemp(join(input.dataDir, '.archive-config-'))
  let child: ChildProcess | undefined
  let spawnError = false
  try {
    child = spawn(getOpencodeBinary('opencode-v1'), ['serve', '--hostname', LOOPBACK_HOST, '--port', String(input.port)], {
      cwd: input.workspaceDir,
      env: {
        ...createSafeEnv(),
        HOME: input.dataDir,
        XDG_DATA_HOME: join(input.dataDir, '.local', 'share'),
        XDG_STATE_HOME: join(input.dataDir, '.local', 'state'),
        XDG_CONFIG_HOME: configDir,
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
    const runtime = getRuntimeForKind(input.slug, 'opencode-v1', {
      baseUrl: `http://${LOOPBACK_HOST}:${input.port}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, input.password),
      signal,
    })
    if (!runtime.ok) return runtime
    while (!signal.aborted && !spawnError && child.exitCode === null && child.signalCode === null) {
      const health = await runtime.data.health({ signal, timeoutMs: Math.min(3_000, input.timeoutMs) })
      if (health.ok) return await exportLegacySessions(input.slug, runtime.data)
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
        unconfirmedHelpers.set(input.dataDir, { child, configDir })
        throw error
      }
    }
    await rm(configDir, { recursive: true, force: true })
  }
}
