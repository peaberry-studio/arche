import { existsSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

import type { WorkspaceHost, WorkspaceHostConnection, WorkspaceHostStatus } from '@/lib/runtime/types'

const DEFAULT_PORT = 4096
const DEFAULT_AGENT_PORT = 4097
const DEFAULT_USERNAME = 'opencode'
const DEFAULT_PASSWORD = 'arche-desktop'

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
  if (process.resourcesPath) {
    const bundled = join(process.resourcesPath, 'bin', 'opencode')
    if (existsSync(bundled)) {
      return bundled
    }
  }

  return 'opencode'
}

function makeAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export const desktopWorkspaceHost: WorkspaceHost = {
  async start(slug: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const existing = processes.get(slug)
    if (existing && !existing.process.killed) {
      return { ok: true, status: 'already_running' }
    }

    const port = DEFAULT_PORT
    const agentPort = DEFAULT_AGENT_PORT
    const password = process.env.OPENCODE_SERVER_PASSWORD || DEFAULT_PASSWORD

    try {
      const child = spawn(
        getOpencodeBinary(),
        ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
        {
          env: {
            ...process.env,
            OPENCODE_SERVER_PASSWORD: password,
            OPENCODE_SERVER_USERNAME: DEFAULT_USERNAME,
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
