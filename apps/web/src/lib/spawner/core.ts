import { auditService, instanceService, userService } from '@/lib/services'
import { readCommonWorkspaceConfig, readConfigRepoFile } from '@/lib/common-workspace-config-store'
import { getInstanceUrl, isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import * as docker from './docker'
import { decryptPassword, generatePassword, encryptPassword } from './crypto'
import { getStartExpectedMs, getStartTimeoutMs } from './config'
import { buildMcpConfigForSlug } from './mcp-config'
import { injectSelfDelegationGuards, remapAgentConnectorTools } from './agent-config-transforms'
import { getRuntimeConfigHashForSlug } from './runtime-config-hash'

export type StartResult =
  | { ok: true; status: 'running' }
  | { ok: false; error: 'already_running' | 'start_failed' | 'timeout'; detail?: string }

export type StopResult =
  | { ok: true; status: 'stopped' }
  | { ok: false; error: 'not_running' | 'stop_failed' }

function getErrorDetail(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const error = err as {
    json?: { message?: string }
    message?: string
    reason?: string
  }

  return error.json?.message ?? error.message ?? error.reason
}

function withWorkspaceIdentity(agentsMd: string, identity: { slug: string; email?: string | null }): string {
  const emailLine = identity.email ? `- Email: ${identity.email}\n` : ''
  const block =
    `\n\n## Workspace User Identity\n\n` +
    `Use this identity as the primary user context for this workspace session.\n\n` +
    `- Slug: ${identity.slug}\n` +
    emailLine

  return agentsMd + block
}

export async function startInstance(slug: string, userId: string): Promise<StartResult> {
  const existing = await instanceService.findBySlug(slug)
  const runtimeHashResult = await getRuntimeConfigHashForSlug(slug)
  const appliedConfigSha = runtimeHashResult.ok ? runtimeHashResult.hash : null

  if (existing?.status === 'running') {
    return { ok: false, error: 'already_running' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)

  await instanceService.upsertStarting(slug, encryptedPassword)

  let containerId: string | null = null

  try {
    let opencodeConfigContent: string | undefined
    try {
      // Read workspace config (agents, default_agent, prompts, etc.)
      let baseConfig: Record<string, unknown> = {}
      const commonConfigResult = await readCommonWorkspaceConfig()
      if (commonConfigResult.ok) {
        try {
          baseConfig = JSON.parse(commonConfigResult.content)
        } catch {
          console.warn('[spawner] Failed to parse CommonWorkspaceConfig')
        }
      }

      // Merge MCP connectors config and remap connector IDs for the current user
      const mcpConfig = await buildMcpConfigForSlug(slug)
      if (mcpConfig?.mcp && Object.keys(mcpConfig.mcp).length > 0) {
        const userMcpKeys = new Set(Object.keys(mcpConfig.mcp))
        baseConfig = remapAgentConnectorTools(baseConfig, userMcpKeys)
        baseConfig = { ...baseConfig, mcp: mcpConfig.mcp }
      } else {
        baseConfig = remapAgentConnectorTools(baseConfig, new Set())
      }


      const guardedConfig = injectSelfDelegationGuards(baseConfig)

      if (Object.keys(guardedConfig).length > 0) {
        opencodeConfigContent = JSON.stringify(guardedConfig)
      }
    } catch {
      console.warn('[spawner] Config build failed')
    }

    // Read AGENTS.md from config repo to inject into workspace
    let agentsMd: string | undefined
    try {
      const agentsResult = await readConfigRepoFile('AGENTS.md')
      if (agentsResult.ok) {
        agentsMd = agentsResult.content
      }
    } catch {
      console.warn('[spawner] Failed to read AGENTS.md')
    }

    const owner = await userService.findIdentityBySlug(slug)

    if (agentsMd) {
      agentsMd = withWorkspaceIdentity(agentsMd, {
        slug: owner?.slug ?? slug,
        email: owner?.email,
      })
    }

    const container = await docker.createContainer(slug, password, opencodeConfigContent, agentsMd, {
      name: owner?.slug ?? slug,
      email: owner?.email,
    })
    containerId = container.id
    await docker.startContainer(container.id)

    await instanceService.setContainerId(slug, container.id)

    const healthy = await waitForHealthy(container.id, slug, password)

    if (!healthy) {
      await docker.stopContainer(container.id).catch(() => {})
      await docker.removeContainer(container.id).catch(() => {})
      containerId = null
      await instanceService.setError(slug)
      return { ok: false, error: 'timeout', detail: 'healthcheck timeout' }
    }

    // Sync providers and clear OpenCode's discovery cache BEFORE marking as
    // 'running'. The DB status gates all frontend connections, so providers
    // must be ready before it flips.
    const syncUserId = owner?.id ?? userId
    const syncResult = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      slug,
      userId: syncUserId,
    })
    if (!syncResult.ok) {
      console.error('[spawner] Failed to sync OpenCode providers', syncResult.error)
    }

    await instanceService.setRunning(slug, appliedConfigSha)

    await auditService.createEvent({
      actorUserId: userId,
      action: 'instance.started',
      metadata: { slug },
    })

    return { ok: true, status: 'running' }
  } catch (err) {
    const detail = getErrorDetail(err)
    if (detail) {
      console.error('[spawner] startInstance failed:', detail)
    } else {
      console.error('[spawner] startInstance failed: unknown error')
    }

    // Clean up container if it was created to avoid orphans and name conflicts
    if (containerId) {
      await docker.stopContainer(containerId).catch(() => {})
      await docker.removeContainer(containerId).catch(() => {})
    }

    await instanceService.setError(slug).catch(() => {})

    return { ok: false, error: 'start_failed', detail }
  }
}

export async function stopInstance(slug: string, userId: string): Promise<StopResult> {
  const instance = await instanceService.findBySlug(slug)

  if (!instance || instance.status === 'stopped') {
    return { ok: false, error: 'not_running' }
  }

  try {
    if (instance.containerId) {
      await docker.stopContainer(instance.containerId).catch(() => {})
      await docker.removeContainer(instance.containerId).catch(() => {})
    }

    await instanceService.setStopped(slug)

    await auditService.createEvent({
      actorUserId: userId,
      action: 'instance.stopped',
      metadata: { slug },
    })

    return { ok: true, status: 'stopped' }
  } catch {
    return { ok: false, error: 'stop_failed' }
  }
}

export async function getInstanceStatus(slug: string) {
  const instance = await instanceService.findStatusBySlug(slug)

  if (!instance) return null

  // If the DB says running/starting but there is no containerId, it is out of sync
  if ((instance.status === 'running' || instance.status === 'starting') && !instance.containerId) {
    await instanceService.setStoppedNoContainer(slug)
    return { ...instance, status: 'stopped' as const, containerId: null }
  }

  // If there is a containerId, verify the container actually exists and is running
  if (instance.containerId && (instance.status === 'running' || instance.status === 'starting')) {
    const isRunning = await docker.isContainerRunning(instance.containerId)

    if (!isRunning) {
      // Container does not exist or is not running - sync DB
      // Try to remove the container if it still exists
      await docker.removeContainer(instance.containerId).catch(() => {})

      await instanceService.setStopped(slug)
      return { ...instance, status: 'stopped' as const, containerId: null }
    }

    // Verify OpenCode is actually responding
    try {
      const password = decryptPassword(instance.serverPassword)
      const isHealthy = await isInstanceHealthyWithPassword(slug, password)

      if (isHealthy) {
        if (instance.status !== 'running') {
          await instanceService.correctToRunning(slug)
        }
        return { ...instance, status: 'running' as const }
      }

      if (instance.status === 'running') {
        // Container is running but OpenCode is not responding - mark as starting
        // so the frontend waits and retries
        return { ...instance, status: 'starting' as const }
      }
    } catch (err) {
      console.error('[spawner] Failed to decrypt instance password', err)
    }
  }

  return instance
}

export async function listActiveInstances() {
  return instanceService.findActiveInstances()
}

export function isSlowStart(instance: { status: string; startedAt: Date | null } | null): boolean {
  if (!instance || instance.status !== 'starting' || !instance.startedAt) {
    return false
  }
  const elapsed = Date.now() - instance.startedAt.getTime()
  return elapsed > getStartExpectedMs()
}

async function waitForHealthy(containerId: string, slug: string, password: string): Promise<boolean> {
  const timeout = getStartTimeoutMs()
  const start = Date.now()

  while (Date.now() - start < timeout) {
    // First check if container is running
    const running = await docker.isContainerRunning(containerId)
    if (!running) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    // Then verify OpenCode is actually responding
    const healthy = await isInstanceHealthyWithPassword(slug, password)
    if (healthy) return true

    await new Promise(r => setTimeout(r, 1000))
  }

  return false
}
