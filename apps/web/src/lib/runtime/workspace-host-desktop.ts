import { randomBytes } from 'crypto'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'

import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'
import { getKbContentRoot } from '@/lib/runtime/paths'
import { instanceService } from '@/lib/services'
import { getWorkspaceAgentPort } from '@/lib/spawner/config'
import { encryptPassword } from '@/lib/spawner/crypto'

declare global {
  var archeDesktopCleanupRegistered: boolean | undefined
}

const DEFAULT_PORT = 4096
const DEFAULT_USERNAME = 'opencode'
const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_NEXT_PORT = 3000
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

function logDesktopRuntime(
  slug: string,
  component: string,
  event: string,
  detail?: string,
): void {
  const payload = {
    slug,
    component,
    event,
    detail,
    mode: 'desktop',
  }

  console.log(`[desktop-runtime] ${JSON.stringify(payload)}`)
}

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

function getDesktopProviderGatewayConfig(): Record<string, unknown> {
  const gateway = `http://${LOOPBACK_HOST}:${getDesktopWebPort()}/api/internal/providers`
  return {
    provider: {
      openai: { options: { baseURL: `${gateway}/openai` } },
      anthropic: { options: { baseURL: `${gateway}/anthropic` } },
      openrouter: { options: { baseURL: `${gateway}/openrouter` } },
      opencode: { options: { baseURL: `${gateway}/opencode` } },
    },
  }
}

function getDesktopWebPort(): number {
  const raw = process.env.ARCHE_DESKTOP_WEB_PORT ?? process.env.PORT
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NEXT_PORT
}

async function findAvailablePort(preferredPort: number, excludedPorts: number[] = []): Promise<number> {
  const preferredResult = await tryListen(preferredPort)
  if (preferredResult.ok && !excludedPorts.includes(preferredResult.port)) {
    return preferredResult.port
  }

  if (!preferredResult.ok && preferredResult.errorCode !== 'EADDRINUSE') {
    throw preferredResult.error
  }

  const fallbackResult = await tryListen(0)
  if (!fallbackResult.ok) {
    throw fallbackResult.error
  }

  if (excludedPorts.includes(fallbackResult.port)) {
    return findAvailablePort(0, excludedPorts)
  }

  return fallbackResult.port
}

type ListenResult =
  | { ok: true; port: number }
  | { ok: false; error: Error; errorCode?: string }

async function tryListen(port: number): Promise<ListenResult> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, error, errorCode: error.code })
    })

    server.listen(port, LOOPBACK_HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          resolve({ ok: false, error: new Error('Failed to resolve listening port') })
        })
        return
      }

      server.close(() => {
        resolve({ ok: true, port: address.port })
      })
    })
  })
}

function getArcheOpencodeDataDir(): string {
  const baseDir = process.env.ARCHE_OPENCODE_DATA_DIR || join(process.env.HOME || '', '.arche-opencode')
  const workspaceDir = join(baseDir, 'data')
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  return workspaceDir
}

function getWorkspaceDir(slug: string): string {
  const baseDir = process.env.ARCHE_OPENCODE_DATA_DIR || join(process.env.HOME || '', '.arche-opencode')
  const workspaceDir = join(baseDir, 'workspaces', slug)
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  if (!existsSync(join(workspaceDir, '.git'))) {
    execFileSync('git', ['init', '-b', 'main', workspaceDir])
    execFileSync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: workspaceDir })
  }
  // Ensure the kb remote points to the bare KB content repo
  const kbContentDir = getKbContentRoot()
  try {
    const currentUrl = execFileSync('git', ['remote', 'get-url', 'kb'], { cwd: workspaceDir, encoding: 'utf-8' }).trim()
    if (currentUrl !== kbContentDir) {
      execFileSync('git', ['remote', 'set-url', 'kb', kbContentDir], { cwd: workspaceDir })
    }
  } catch {
    execFileSync('git', ['remote', 'add', 'kb', kbContentDir], { cwd: workspaceDir })
  }
  return workspaceDir
}

function resolveBundledBinary(binaryName: string): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) {
    return null
  }

  const bundledPath = join(resourcesPath, 'bin', binaryName)
  return existsSync(bundledPath) ? bundledPath : null
}

export function getOpencodeBinary(): string {
  if (process.env.ARCHE_OPENCODE_BIN) {
    return process.env.ARCHE_OPENCODE_BIN
  }

  return resolveBundledBinary('opencode') ?? 'opencode'
}

export function getWorkspaceAgentBinary(): string {
  if (process.env.ARCHE_WORKSPACE_AGENT_BIN) {
    return process.env.ARCHE_WORKSPACE_AGENT_BIN
  }

  return resolveBundledBinary('workspace-agent') ?? 'workspace-agent'
}

function hasBinaryOnPath(binaryName: string): boolean {
  const pathValue = process.env.PATH
  if (!pathValue) {
    return false
  }

  for (const part of pathValue.split(':')) {
    if (!part) {
      continue
    }

    if (existsSync(join(part, binaryName))) {
      return true
    }
  }

  return false
}

function canSpawnWorkspaceAgent(): boolean {
  if (process.env.ARCHE_WORKSPACE_AGENT_BIN) {
    return existsSync(process.env.ARCHE_WORKSPACE_AGENT_BIN)
  }

  if (resolveBundledBinary('workspace-agent')) {
    return true
  }

  if (hasBinaryOnPath('workspace-agent')) {
    return true
  }

  return false
}

function makeAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function generateDesktopPassword(): string {
  return randomBytes(24).toString('base64url')
}

function createSafeEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    USER: process.env.USER,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    HOME: process.env.HOME,
  }
}

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

function registerProcessExit(
  slug: string,
  managed: ManagedProcess,
): void {
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

async function waitForHttpReady(
  url: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const deadline = Date.now() + getStartTimeoutMs()

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3_000),
      })

      if (response.ok || response.status === 401 || response.status === 404) {
        return true
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, getStartIntervalMs()))
  }

  return false
}

async function waitForOpenCodeHealthy(port: number, password: string): Promise<boolean> {
  const authHeader = makeAuthHeader(DEFAULT_USERNAME, password)
  const deadline = Date.now() + getStartTimeoutMs()

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${LOOPBACK_HOST}:${port}/global/health`, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3_000),
      })

      if (response.ok) {
        const data = await response.json().catch(() => null)
        if (data?.healthy === true) {
          return true
        }
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, getStartIntervalMs()))
  }

  return false
}

async function stopManagedProcess(slug: string, managed: ManagedProcess): Promise<void> {
  managed.expectedExit = true
  managed.child.kill('SIGTERM')

  const exited = await new Promise<boolean>((resolve) => {
    if (managed.child.killed) {
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

  try {
    await runtime.stopPromise
  } finally {
    runtime.stopPromise = null
  }
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
  return {
    name,
    child,
    ready: false,
    expectedExit: false,
  }
}

export const desktopWorkspaceHost: WorkspaceHost = {
  async start(
    slug: string,
    userId: string,
  ): Promise<{ ok: true; status: string } | { ok: false; error: string; detail?: string }> {
    ensureCleanupHooks()

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

    const port = await findAvailablePort(DEFAULT_PORT)
    const agentPort = await findAvailablePort(preferredAgentPort, [port])

    writeFileSync(
      join(workspaceDir, 'opencode.json'),
      JSON.stringify(getDesktopProviderGatewayConfig()),
      'utf-8',
    )

    await instanceService.upsertStarting(slug, encryptedPassword)

    const opencodeProcess = createManagedProcess(
      'opencode',
      spawn(getOpencodeBinary(), ['serve', '--hostname', LOOPBACK_HOST, '--port', String(port)], {
        cwd: workspaceDir,
        env: {
          ...safeEnv,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_SERVER_USERNAME: DEFAULT_USERNAME,
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

    try {
      const [opencodeReady, workspaceAgentReady] = await Promise.all([
        waitForOpenCodeHealthy(port, password),
        workspaceAgentProcess
          ? waitForHttpReady(`http://${LOOPBACK_HOST}:${agentPort}/health`, {
              Authorization: authHeader,
              Accept: 'application/json',
            })
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

      const syncResult = await syncProviderAccessForInstance({
        instance: {
          baseUrl: `http://${LOOPBACK_HOST}:${port}`,
          authHeader,
        },
        slug,
        userId,
      })
      if (!syncResult.ok) {
        console.error('[desktop] Failed to sync OpenCode providers', syncResult.error)
      }

      const runtime = runtimes.get(slug)
      if (!runtime) {
        return { ok: false, error: 'start_failed', detail: 'runtime_disposed_during_start' }
      }

      runtime.state = 'running'
      runtime.lastErrorDetail = null
      logDesktopRuntime(slug, 'runtime', 'state_changed', 'running')
      await instanceService.setRunning(slug, null)

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
      return {
        status: 'stopped',
        startedAt: null,
        stoppedAt: null,
        lastActivityAt: null,
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
