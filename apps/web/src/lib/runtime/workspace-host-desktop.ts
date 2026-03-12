import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { instanceService } from '@/lib/services'
import { encryptPassword } from '@/lib/spawner/crypto'
import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'

const DEFAULT_PORT = 4096
const DEFAULT_AGENT_PORT = 4097
const DEFAULT_USERNAME = 'opencode'
const DEFAULT_PASSWORD = 'arche-desktop'
const NEXT_PORT = 3000

function getDesktopProviderGatewayConfig(): Record<string, unknown> {
  const gateway = `http://localhost:${NEXT_PORT}/api/internal/providers`
  return {
    provider: {
      openai: { options: { baseURL: `${gateway}/openai` } },
      anthropic: { options: { baseURL: `${gateway}/anthropic` } },
      openrouter: { options: { baseURL: `${gateway}/openrouter` } },
      opencode: { options: { baseURL: `${gateway}/opencode` } },
    },
  }
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
  return workspaceDir
}

type LocalProcess = {
  process: ChildProcess
  port: number
  agentPort: number
  password: string
  startedAt: Date
}

const processes = new Map<string, LocalProcess>()

/**
 * Resolves the OpenCode binary path. Priority:
 * 1. ARCHE_OPENCODE_BIN env var (explicit override)
 * 2. Bundled binary inside Electron's extraResources (packaged app)
 * 3. Fallback to PATH lookup (development)
 */
export function getOpencodeBinary(): string {
  if (process.env.ARCHE_OPENCODE_BIN) {
    return process.env.ARCHE_OPENCODE_BIN
  }

  // In a packaged Electron app, process.resourcesPath points to the
  // Resources directory inside the .app bundle. The binary is placed
  // there by electron-builder's extraResources config.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'bin', 'opencode')
    if (existsSync(bundled)) {
      return bundled
    }
  }

  return 'opencode'
}

function makeAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function waitForHealthy(
  host: string,
  port: number,
  username: string,
  password: string,
  maxAttempts = 30,
  intervalMs = 1000,
): Promise<boolean> {
  const authHeader = makeAuthHeader(username, password)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://${host}:${port}/global/health`, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        const data = await response.json().catch(() => null)
        if (data?.healthy === true) {
          return true
        }
      }
    } catch {
      // ignore
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return false
}

export const desktopWorkspaceHost: WorkspaceHost = {
  async start(slug: string, userId: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const existing = processes.get(slug)
    if (existing && !existing.process.killed) {
      return { ok: true, status: 'already_running' }
    }

    const port = DEFAULT_PORT
    const agentPort = DEFAULT_AGENT_PORT
    const password = process.env.OPENCODE_SERVER_PASSWORD || DEFAULT_PASSWORD
    const archeDataDir = getArcheOpencodeDataDir()
    const workspaceDir = getWorkspaceDir(slug)
    const encryptedPassword = encryptPassword(password)

    const safeEnv = {
      PATH: process.env.PATH,
      SHELL: process.env.SHELL,
      TERM: process.env.TERM,
      USER: process.env.USER,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
    }

    const opencodeConfig = getDesktopProviderGatewayConfig()
    writeFileSync(
      join(workspaceDir, 'opencode.json'),
      JSON.stringify(opencodeConfig),
      'utf-8',
    )

    await instanceService.upsertStarting(slug, encryptedPassword)

    try {
      const child = spawn(
        getOpencodeBinary(),
        ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
        {
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
        },
      )

      child.on('error', () => {
        processes.delete(slug)
      })

      child.on('exit', () => {
        processes.delete(slug)
      })

      processes.set(slug, {
        process: child,
        port,
        agentPort,
        password,
        startedAt: new Date(),
      })

      const healthy = await waitForHealthy('localhost', port, DEFAULT_USERNAME, password)
      if (!healthy) {
        child.kill('SIGTERM')
        processes.delete(slug)
        return { ok: false, error: 'start_failed', detail: 'healthcheck timeout' }
      }

      const syncResult = await syncProviderAccessForInstance({
        instance: {
          baseUrl: `http://localhost:${port}`,
          authHeader: makeAuthHeader(DEFAULT_USERNAME, password),
        },
        slug,
        userId,
      })
      if (!syncResult.ok) {
        console.error('[desktop] Failed to sync OpenCode providers', syncResult.error)
      }

      await instanceService.setRunning(slug, null)

      return { ok: true, status: 'started' }
    } catch {
      return { ok: false, error: 'start_failed' }
    }
  },

  async stop(slug: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const entry = processes.get(slug)
    if (!entry) {
      return { ok: true, status: 'already_stopped' }
    }

    entry.process.kill('SIGTERM')
    processes.delete(slug)
    await instanceService.setStopped(slug)
    return { ok: true, status: 'stopped' }
  },

  async getStatus(slug: string): Promise<WorkspaceHostStatus | null> {
    const entry = processes.get(slug)
    if (!entry || entry.process.killed) {
      return {
        status: 'stopped',
        startedAt: null,
        stoppedAt: null,
        lastActivityAt: null,
      }
    }

    return {
      status: 'running',
      startedAt: entry.startedAt,
      stoppedAt: null,
      lastActivityAt: new Date(),
    }
  },

  async getConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const entry = processes.get(slug)
    if (!entry || entry.process.killed) return null

    return {
      baseUrl: `http://localhost:${entry.port}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, entry.password),
    }
  },

  async getAgentConnection(slug: string): Promise<WorkspaceHostConnection | null> {
    const entry = processes.get(slug)
    if (!entry || entry.process.killed) return null

    return {
      baseUrl: `http://localhost:${entry.agentPort}`,
      authHeader: makeAuthHeader(DEFAULT_USERNAME, entry.password),
    }
  },
}
