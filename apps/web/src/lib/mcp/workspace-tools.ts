import { readConfigRepoFileBuffer } from '@/lib/config-repo-store'
import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import type { RuntimeUser } from '@/lib/runtime/types'
import { listSkills, readSkill, readSkillBundle } from '@/lib/skills/skill-store'
import { withWorkspaceIdentity } from '@/lib/spawner/runtime-config-utils'
import {
  type CommonWorkspaceConfig,
  getAgentSummaries,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export async function readAgentsGuide(input: { user?: RuntimeUser } = {}): Promise<
  | { ok: true; content: string; hash: string | null }
  | { ok: false; error: 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const result = await readConfigRepoFileBuffer('AGENTS.md')
  if (!result.ok) return result

  const raw = result.content.toString('utf-8')
  return {
    ok: true,
    content: input.user
      ? withWorkspaceIdentity(raw, { slug: input.user.slug, email: input.user.email })
      : raw,
    hash: result.hash,
  }
}

export async function listAgents(): Promise<
  | { ok: true; agents: ReturnType<typeof getAgentSummaries> }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const config = await loadWorkspaceConfig()
  if (!config.ok) return config

  return { ok: true, agents: getAgentSummaries(config.config) }
}

export async function readAgent(id: string): Promise<
  | { ok: true; agent: ReturnType<typeof getAgentSummaries>[number] }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const agents = await listAgents()
  if (!agents.ok) return agents

  const agent = agents.agents.find((entry) => entry.id === id)
  if (!agent) return { ok: false, error: 'not_found' }

  return { ok: true, agent }
}

export async function listSkillsForMcp(): Promise<Awaited<ReturnType<typeof listSkills>>> {
  return listSkills()
}

export async function readSkillForMcp(name: string): Promise<Awaited<ReturnType<typeof readSkill>>> {
  return readSkill(name)
}

export async function readSkillResource(input: { name: string; path: string; maxLines?: number }): Promise<
  | { ok: true; name: string; path: string; content: string; truncated: boolean }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const normalizedPath = normalizeSkillResourcePath(input.path)
  if (!normalizedPath) return { ok: false, error: 'invalid_path' }

  const bundle = await readSkillBundle(input.name)
  if (!bundle.ok) {
    return { ok: false, error: bundle.error === 'invalid_config' ? 'read_failed' : bundle.error }
  }

  const file = bundle.data.files.find((entry) => entry.path === normalizedPath)
  if (!file) return { ok: false, error: 'not_found' }

  const content = Buffer.from(file.content).toString('utf-8')
  const maxLines = input.maxLines && input.maxLines > 0 ? Math.min(input.maxLines, 2000) : 2000
  const lines = content.split('\n')
  const truncated = lines.length > maxLines
  return {
    ok: true,
    name: input.name,
    path: normalizedPath,
    content: truncated ? lines.slice(0, maxLines).join('\n') : content,
    truncated,
  }
}

async function loadWorkspaceConfig(): Promise<
  | { ok: true; config: CommonWorkspaceConfig }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }
> {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) return result

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) return { ok: false, error: 'invalid_config' }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) return { ok: false, error: 'invalid_config' }

  return { ok: true, config: parsed.config }
}

function normalizeSkillResourcePath(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')

  if (!normalized || normalized === 'SKILL.md') return null
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}
