import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'

import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { toRuntimeProviderId } from '@/lib/providers/types'
import {
  injectAlwaysOnAgentTools,
  injectSelfDelegationGuards,
  remapAgentConnectorTools,
} from '@/lib/spawner/agent-config-transforms'
import { buildMcpConfigForSlug } from '@/lib/spawner/mcp-config'

const DEFAULT_NEXT_PORT = 3000
const DEFAULT_USERNAME = 'opencode'
const LOOPBACK_HOST = '127.0.0.1'

export { DEFAULT_USERNAME, LOOPBACK_HOST }

export function getDesktopWebPort(): number {
  const raw = process.env.ARCHE_DESKTOP_WEB_PORT ?? process.env.PORT
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NEXT_PORT
}

export function getDesktopProviderGatewayConfig(): Record<string, unknown> {
  const gateway = `http://${LOOPBACK_HOST}:${getDesktopWebPort()}/api/internal/providers`
  return {
    provider: {
      openai: { options: { baseURL: `${gateway}/openai` } },
      anthropic: { options: { baseURL: `${gateway}/anthropic` } },
      [toRuntimeProviderId('fireworks')]: { options: { baseURL: `${gateway}/fireworks` } },
      openrouter: { options: { baseURL: `${gateway}/openrouter` } },
      opencode: { options: { baseURL: `${gateway}/opencode` } },
    },
  }
}

function resolveFallbackDesktopOpencodeConfigDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const bundledPath = join(resourcesPath, 'opencode-config')
    if (existsSync(bundledPath)) {
      return bundledPath
    }
  }

  const candidates = [
    join(process.cwd(), 'infra', 'workspace-image', 'opencode-config'),
    join(process.cwd(), '..', '..', 'infra', 'workspace-image', 'opencode-config'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function getDesktopOpencodeConfigDir(): string | null {
  const explicitPath = process.env.ARCHE_OPENCODE_CONFIG_DIR
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath
  }

  return resolveFallbackDesktopOpencodeConfigDir()
}

function parseJsonConfig(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {}

  return {}
}

export async function buildDesktopOpencodeConfig(slug: string): Promise<Record<string, unknown>> {
  const providerGatewayConfig = getDesktopProviderGatewayConfig()

  let baseConfig: Record<string, unknown> = {}

  const commonConfigResult = await readCommonWorkspaceConfig()
  if (commonConfigResult.ok) {
    baseConfig = parseJsonConfig(commonConfigResult.content)
  }

  try {
    const mcpConfig = await buildMcpConfigForSlug(slug)
    if (mcpConfig?.mcp && Object.keys(mcpConfig.mcp).length > 0) {
      const userMcpKeys = new Set(Object.keys(mcpConfig.mcp))
      baseConfig = remapAgentConnectorTools(baseConfig, userMcpKeys)
      baseConfig = { ...baseConfig, mcp: mcpConfig.mcp }
    } else {
      baseConfig = remapAgentConnectorTools(baseConfig, new Set())
    }
  } catch {
    console.warn('[desktop-runtime] Config build failed')
    baseConfig = remapAgentConnectorTools(baseConfig, new Set())
  }

  baseConfig = injectAlwaysOnAgentTools(baseConfig)
  const guardedConfig = injectSelfDelegationGuards(baseConfig)

  return { ...guardedConfig, ...providerGatewayConfig }
}

export function makeAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export function generateDesktopPassword(): string {
  return randomBytes(24).toString('base64url')
}

export function createSafeEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    USER: process.env.USER,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT,
  }
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

export function canSpawnWorkspaceAgent(): boolean {
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
