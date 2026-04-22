import { spawn, type ChildProcess } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'

import { isE2eFakeRuntimeEnabled } from '@/lib/e2e/runtime'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getKbContentRoot } from '@/lib/runtime/paths'
import { desktopWorkspaceHostE2e } from '@/lib/runtime/workspace-host-desktop-e2e'
import {
  checkOpenCodeHealthy,
  waitForHttpReady,
  waitForOpenCodeHealthy,
} from '@/lib/runtime/desktop/health'
import { findAvailablePort } from '@/lib/runtime/desktop/network'
import {
  DEFAULT_USERNAME,
  LOOPBACK_HOST,
  canSpawnWorkspaceAgent,
  createSafeEnv,
  generateDesktopPassword,
  getDesktopOpencodeConfigDir,
  getDesktopProviderGatewayConfig,
  getOpencodeBinary,
  getWorkspaceAgentBinary,
  makeAuthHeader,
} from '@/lib/runtime/desktop/config'
import { getArcheOpencodeDataDir, getWorkspaceDir } from '@/lib/runtime/desktop/workspace-dirs'
import { writeRuntimeSkills } from '@/lib/skills/runtime-skills'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { instanceService, providerService } from '@/lib/services'
import { getWorkspaceAgentPort } from '@/lib/spawner/config'
import { decryptPassword, encryptPassword } from '@/lib/spawner/crypto'
import {
  buildWorkspaceRuntimeArtifacts,
  hashWorkspaceRuntimeArtifacts,
} from '@/lib/spawner/runtime-artifacts'

// Re-export for consumers that import from this module
export { getOpencodeBinary, getWorkspaceAgentBinary }

declare global {
  var archeDesktopCleanupRegistered: boolean | undefined
}

const DEFAULT_PORT = 4096
const DEFAULT_START_TIMEOUT_MS = 30_000
const DEFAULT_START_INTERVAL_MS = 500
const SHUTDOWN_TIMEOUT_MS = 5_000
const DESKTOP_OPENCODE_PORT_ENV = 'ARCHE_DESKTOP_OPENCODE_PORT'
const DESKTOP_WORKSPACE_AGENT_PORT_ENV = 'ARCHE_DESKTOP_WORKSPACE_AGENT_PORT'

type RuntimeState = 'stopped' | 'starting' | 'running' | 'error'

type ManagedProcess = {
  name: 'opencode' | 'workspace-agent'
  child: ChildProcess
  ready: boolean
  expectedExit: boolean
}

type LocalRuntime = {
  opencode: ManagedProcess
  workspaceAgent: ManagedProcess | null
  workspaceAgentAvailable: boolean
  port: number
  agentPort: number
  password: string
  startedAt: Date
  state: RuntimeState
  stopPromise: Promise<void> | null
  lastErrorDetail: string | null
}

const runtimes = new Map<string, LocalRuntime>()

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

function getStartTimeoutMs(): number {
  const raw = process.env.ARCHE_DESKTOP_START_TIMEOUT_MS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_START_TIMEOUT_MS
}

function getStartIntervalMs(): number {
  const raw = process.env.ARCHE_DESKTOP_START_INTERVAL_MS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_START_INTERVAL_MS
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logDesktopRuntime(
  slug: string,
  component: string,
  event: string,
  detail?: string,
): void {
  const payload = { slug, component, event, detail, mode: 'desktop' }
  console.log(`[desktop-runtime] ${JSON.stringify(payload)}`)
}

async function syncProvidersWithRetry(input: {
  authHeader: string
  intervalMs: number
  port: number
  slug: string
  timeoutMs: number
  userId: string
}): Promise<Awaited<ReturnType<typeof syncProviderAccessForInstance>>> {
  const deadline = Date.now() + input.timeoutMs
  let attempt = 1

  while (true) {
    const result = await syncProviderAccessForInstance({
      instance: {
        baseUrl: `http://${LOOPBACK_HOST}:${input.port}`,
        authHeader: input.authHeader,
      },
      slug: input.slug,
      userId: input.userId,
    })

    if (result.ok || Date.now() >= deadline) {
      return result
    }

    logDesktopRuntime(
      input.slug,
      'providers',
      'sync_retry',
      `attempt=${String(attempt)} error=${result.error}`,
    )
    attempt += 1

    await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
  }
}

// ---------------------------------------------------------------------------
// Port env sync
// ---------------------------------------------------------------------------

function setDesktopRuntimePortEnv(runtime: Pick<LocalRuntime, 'port' | 'agentPort' | 'workspaceAgentAvailable'>): void {
  process.env[DESKTOP_OPENCODE_PORT_ENV] = String(runtime.port)

  if (runtime.workspaceAgentAvailable) {
    process.env[DESKTOP_WORKSPACE_AGENT_PORT_ENV] = String(runtime.agentPort)
    process.env.WORKSPACE_AGENT_PORT = String(runtime.agentPort)
    return
  }

  delete process.env[DESKTOP_WORKSPACE_AGENT_PORT_ENV]
  delete process.env.WORKSPACE_AGENT_PORT
}

function syncDesktopRuntimePortEnv(): void {
  const runtime = Array.from(runtimes.values())[0]

  if (!runtime) {
    delete process.env[DESKTOP_OPENCODE_PORT_ENV]
    delete process.env[DESKTOP_WORKSPACE_AGENT_PORT_ENV]
    delete process.env.WORKSPACE_AGENT_PORT
    return
  }

  setDesktopRuntimePortEnv(runtime)
}

function getDesktopRuntimePortFromEnv(): number {
  const raw = process.env[DESKTOP_OPENCODE_PORT_ENV]
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}

type DesktopRuntimeArtifacts = {
  skills: Awaited<ReturnType<typeof buildWorkspaceRuntimeArtifacts>>['skills']
  owner: { id: string; slug: string; email: string | null } | null
  opencodeConfigContent: string
  agentsMd?: string
}

async function buildDesktopRuntimeArtifacts(slug: string): Promise<DesktopRuntimeArtifacts> {
  return buildWorkspaceRuntimeArtifacts(slug, getDesktopProviderGatewayConfig())
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

function attachChildLogging(slug: string, processName: ManagedProcess['name'], child: ChildProcess): void {
  child.stdout?.on('data', (data: Buffer | string) => {
    const detail = data.toString().trim()
    if (detail) {
      logDesktopRuntime(slug, processName, 'stdout', detail)
    }
  })

  child.stderr?.on('data', (data: Buffer | string) => {
    const detail = data.toString().trim()
    if (detail) {
      logDesktopRuntime(slug, processName, 'stderr', detail)
    }
  })
}

function markRuntimeError(slug: string, detail: string): void {
  const runtime = runtimes.get(slug)
  if (!runtime) {
    return
  }

  runtime.state = 'error'
  runtime.lastErrorDetail = detail
  logDesktopRuntime(slug, 'runtime', 'state_changed', detail)
  void instanceService.setError(slug).catch((error: unknown) => {
    console.error('[desktop-runtime] Failed to persist error state', { slug, error })
  })
}

function registerProcessExit(slug: string, managed: ManagedProcess): void {
  managed.child.on('error', (error) => {
    const detail = error instanceof Error ? error.message : 'spawn_failed'
    logDesktopRuntime(slug, managed.name, 'error', detail)
    if (!managed.expectedExit) {
      markRuntimeError(slug, `${managed.name}:${detail}`)
    }
  })

  managed.child.on('exit', (code, signal) => {
    managed.ready = false
    logDesktopRuntime(slug, managed.name, 'exit', `code=${String(code)} signal=${String(signal)}`)
    if (!managed.expectedExit) {
      markRuntimeError(slug, `${managed.name}:code=${String(code)} signal=${String(signal)}`)
    }
  })
}

async function stopManagedProcess(slug: string, managed: ManagedProcess): Promise<void> {
  managed.expectedExit = true
  managed.child.kill('SIGTERM')

  const exited = await new Promise<boolean>((resolve) => {
    if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
      resolve(true)
      return
    }

    const timer = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS)
    managed.child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

  if (!exited) {
    logDesktopRuntime(slug, managed.name, 'shutdown_escalated')
    managed.child.kill('SIGKILL')
  }
}

async function stopRuntime(slug: string, persistStoppedState: boolean): Promise<void> {
  const runtime = runtimes.get(slug)
  if (!runtime) {
    return
  }

  if (runtime.stopPromise) {
    return runtime.stopPromise
  }

  runtime.stopPromise = (async () => {
    await Promise.allSettled([
      runtime.workspaceAgent ? stopManagedProcess(slug, runtime.workspaceAgent) : Promise.resolve(),
      stopManagedProcess(slug, runtime.opencode),
    ])

    runtimes.delete(slug)
    syncDesktopRuntimePortEnv()

    if (persistStoppedState) {
      await instanceService.setStopped(slug)
    }
  })()

  await runtime.stopPromise
}

async function stopAllDesktopRuntimes(): Promise<void> {
  await Promise.allSettled(
    Array.from(runtimes.keys(), (slug) => stopRuntime(slug, false)),
  )
}

function ensureCleanupHooks(): void {
  if (globalThis.archeDesktopCleanupRegistered) {
    return
  }

  globalThis.archeDesktopCleanupRegistered = true
  process.once('SIGINT', () => {
    void stopAllDesktopRuntimes().finally(() => process.kill(process.pid, 'SIGINT'))
  })
  process.once('SIGTERM', () => {
    void stopAllDesktopRuntimes().finally(() => process.kill(process.pid, 'SIGTERM'))
  })
  process.once('beforeExit', () => {
    void stopAllDesktopRuntimes()
  })
}

function createManagedProcess(name: ManagedProcess['name'], child: ChildProcess): ManagedProcess {
  return { name, child, ready: false, expectedExit: false }
}

// ---------------------------------------------------------------------------
// Startup reconciliation
// ---------------------------------------------------------------------------

let reconciled = false

export async function reconcileDesktopInstances(): Promise<void> {
  if (reconciled) return
  reconciled = true

  const activeInstances = await instanceService.findActiveInstances()
  if (activeInstances.length === 0) return

  for (const instance of activeInstances) {
    if (!runtimes.has(instance.slug)) {
      logDesktopRuntime(instance.slug, 'runtime', 'reconcile_stopped',
        `status=${instance.status} had no backing process after restart`)
      await instanceService.setStopped(instance.slug)
    }
  }
}

// ---------------------------------------------------------------------------
// WorkspaceHost implementation
// ---------------------------------------------------------------------------

const desktopWorkspaceHostReal: WorkspaceHost = {
  async start(
    slug: string,
    userId: string,
  ): Promise<{ ok: true; status: string } | { ok: false; error: string; detail?: string }> {
    ensureCleanupHooks()
    await reconcileDesktopInstances()

    const existing = runtimes.get(slug)
    if (existing && existing.state === 'running') {
      setDesktopRuntimePortEnv(existing)
      return { ok: true, status: 'already_running' }
    }

    const password = process.env.OPENCODE_SERVER_PASSWORD || generateDesktopPassword()
    const encryptedPassword = encryptPassword(password)
    const archeDataDir = getArcheOpencodeDataDir()
    const workspaceDir = getWorkspaceDir(slug)
    const kbContentDir = getKbContentRoot()
    const authHeader = makeAuthHeader(DEFAULT_USERNAME, password)
    const preferredAgentPort = getWorkspaceAgentPort()
    const safeEnv = createSafeEnv()
    const opencodeConfigDir = getDesktopOpencodeConfigDir()

    const port = await findAvailablePort(DEFAULT_PORT)
    const agentPort = await findAvailablePort(preferredAgentPort, [port])

    const artifacts = await buildDesktopRuntimeArtifacts(slug)
    const appliedConfigSha = hashWorkspaceRuntimeArtifacts(artifacts)
    const opencodeConfigContent = artifacts.opencodeConfigContent
    const runtimeSkillDir = join(archeDataDir, '.config', 'opencode', 'skills')

    writeFileSync(
      join(workspaceDir, 'opencode.json'),
      opencodeConfigContent,
      'utf-8',
    )

    if (artifacts.agentsMd) {
      writeFileSync(join(workspaceDir, 'AGENTS.md'), artifacts.agentsMd, 'utf-8')
    }

    await writeRuntimeSkills(runtimeSkillDir, artifacts.skills)

    await instanceService.upsertStarting(slug, encryptedPassword)

    const opencodeProcess = createManagedProcess(
      'opencode',
      spawn(getOpencodeBinary(), ['serve', '--hostname', LOOPBACK_HOST, '--port', String(port)], {
        cwd: workspaceDir,
        env: {
          ...safeEnv,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_SERVER_USERNAME: DEFAULT_USERNAME,
          ...(opencodeConfigDir ? { OPENCODE_CONFIG_DIR: opencodeConfigDir } : {}),
          WORKSPACE_DIR: workspaceDir,
          HOME: archeDataDir,
          XDG_DATA_HOME: join(archeDataDir, '.local', 'share'),
          XDG_STATE_HOME: join(archeDataDir, '.local', 'state'),
          XDG_CONFIG_HOME: join(archeDataDir, '.config'),
        },
        stdio: 'pipe',
        detached: false,
      }),
    )

    const workspaceAgentAvailable = canSpawnWorkspaceAgent()
    const workspaceAgentProcess = workspaceAgentAvailable
      ? createManagedProcess(
          'workspace-agent',
          spawn(getWorkspaceAgentBinary(), ['--addr', `${LOOPBACK_HOST}:${agentPort}`], {
            cwd: workspaceDir,
            env: {
              ...safeEnv,
              WORKSPACE_DIR: workspaceDir,
              KB_CONTENT_DIR: kbContentDir,
              OPENCODE_SERVER_PASSWORD: password,
              WORKSPACE_AGENT_PASSWORD: password,
              WORKSPACE_AGENT_USERNAME: DEFAULT_USERNAME,
              WORKSPACE_AGENT_PORT: String(agentPort),
              WORKSPACE_AGENT_ADDR: `${LOOPBACK_HOST}:${agentPort}`,
            },
            stdio: 'pipe',
            detached: false,
          }),
        )
      : null

    attachChildLogging(slug, opencodeProcess.name, opencodeProcess.child)
    registerProcessExit(slug, opencodeProcess)
    if (workspaceAgentProcess) {
      attachChildLogging(slug, workspaceAgentProcess.name, workspaceAgentProcess.child)
      registerProcessExit(slug, workspaceAgentProcess)
    } else {
      logDesktopRuntime(
        slug,
        'workspace-agent',
        'unavailable',
        'workspace-agent binary not found; continuing without agent process',
      )
    }

    runtimes.set(slug, {
      opencode: opencodeProcess,
      workspaceAgent: workspaceAgentProcess,
      workspaceAgentAvailable,
      port,
      agentPort,
      password,
      startedAt: new Date(),
      state: 'starting',
      stopPromise: null,
      lastErrorDetail: null,
    })
    setDesktopRuntimePortEnv({ port, agentPort, workspaceAgentAvailable })

    logDesktopRuntime(slug, 'runtime', 'state_changed', 'starting')

    const timeoutMs = getStartTimeoutMs()
    const intervalMs = getStartIntervalMs()

    try {
      const [opencodeReady, workspaceAgentReady] = await Promise.all([
        waitForOpenCodeHealthy(port, password, timeoutMs, intervalMs),
        workspaceAgentProcess
          ? waitForHttpReady(`http://${LOOPBACK_HOST}:${agentPort}/health`, {
              Authorization: authHeader,
              Accept: 'application/json',
            }, timeoutMs, intervalMs)
          : Promise.resolve(false),
      ])

      if (!opencodeReady || (workspaceAgentProcess && !workspaceAgentReady)) {
        const detail = !opencodeReady
          ? 'opencode_healthcheck_timeout'
          : 'workspace_agent_healthcheck_timeout'
        markRuntimeError(slug, detail)
        await stopRuntime(slug, false)
        return { ok: false, error: 'start_failed', detail }
      }

      opencodeProcess.ready = true
      if (workspaceAgentProcess) {
        workspaceAgentProcess.ready = true
      }

      const syncUserId = artifacts.owner?.id ?? userId
      const syncResult = await syncProvidersWithRetry({
        authHeader,
        intervalMs,
        port,
        slug,
        timeoutMs,
        userId: syncUserId,
      })
      if (!syncResult.ok) {
        await providerService.markWorkspaceRestartRequired(syncUserId)
        console.error('[desktop] Failed to sync OpenCode providers', syncResult.error)
      } else {
        await providerService.clearWorkspaceRestartRequired(syncUserId)
      }

      const runtime = runtimes.get(slug)
      if (!runtime) {
        return { ok: false, error: 'start_failed', detail: 'runtime_disposed_during_start' }
      }

      runtime.state = 'running'
      runtime.lastErrorDetail = null
      logDesktopRuntime(slug, 'runtime', 'state_changed', 'running')
      await instanceService.setRunning(slug, appliedConfigSha)

      return { ok: true, status: 'started' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'start_failed'
      markRuntimeError(slug, detail)
      await stopRuntime(slug, false)
      return { ok: false, error: 'start_failed', detail }
    }
  },

  async stop(slug: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const runtime = runtimes.get(slug)
    if (!runtime) {
      return { ok: true, status: 'already_stopped' }
    }

    runtime.state = 'stopped'
    logDesktopRuntime(slug, 'runtime', 'state_changed', 'stopped')
    await stopRuntime(slug, true)
    return { ok: true, status: 'stopped' }
  },

  async getStatus(slug: string): Promise<WorkspaceHostStatus | null> {
    const runtime = runtimes.get(slug)
    if (!runtime) {
      const instance = await instanceService.findStatusBySlug(slug)
      if (!instance) {
        return {
          status: 'stopped',
          startedAt: null,
          stoppedAt: null,
          lastActivityAt: null,
        }
      }

      if (instance.status === 'running' || instance.status === 'starting') {
        try {
          const password = decryptPassword(instance.serverPassword)
          const healthy = await checkOpenCodeHealthy(getDesktopRuntimePortFromEnv(), password)
          if (healthy) {
            return {
              status: 'running',
              startedAt: instance.startedAt,
              stoppedAt: null,
              lastActivityAt: instance.lastActivityAt,
            }
          }
        } catch (error) {
          console.error('[desktop-runtime] Failed to rebuild persisted status', { slug, error })
        }
      }

      return {
        status: instance.status === 'error' ? 'error' : 'stopped',
        startedAt: instance.startedAt,
        stoppedAt: instance.stoppedAt,
        lastActivityAt: instance.lastActivityAt,
      }
    }

    return {
      status: runtime.state,
      startedAt: runtime.startedAt,
      stoppedAt: runtime.state === 'stopped' ? new Date() : null,
      lastActivityAt: runtime.state === 'running' ? new Date() : null,
    }
  },

  async getConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const runtime = runtimes.get(slug)
    if (!runtime || runtime.state !== 'running') {
      return null
    }

    return {
      baseUrl: `http://${LOOPBACK_HOST}:${runtime.port}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, runtime.password),
    }
  },

  async getAgentConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const runtime = runtimes.get(slug)
    if (!runtime || runtime.state !== 'running') {
      return null
    }

    if (!runtime.workspaceAgentAvailable) {
      return null
    }

    return {
      baseUrl: `http://${LOOPBACK_HOST}:${runtime.agentPort}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, runtime.password),
    }
  },
}

export const desktopWorkspaceHost: WorkspaceHost = isE2eFakeRuntimeEnabled()
  ? desktopWorkspaceHostE2e
  : desktopWorkspaceHostReal
