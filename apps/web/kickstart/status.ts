import {
  readCommonWorkspaceConfig,
  readConfigRepoFile,
} from '@/lib/common-workspace-config-store'
import {
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'
import { isKickstartApplyLocked } from '@/kickstart/lock'
import { contentRepoPathsExist } from '@/kickstart/repositories'
import type { KickstartStatus } from '@/kickstart/types'

const REQUIRED_KB_PATHS: Array<{ path: string; type: 'file' | 'dir' }> = [
  { path: 'Outputs', type: 'dir' },
  { path: 'Company/00 - Company Profile.md', type: 'file' },
  { path: 'Company/01 - Glossary.md', type: 'file' },
]

type GetKickstartStatusOptions = {
  ignoreLock?: boolean
}

async function isConfigReady(): Promise<boolean> {
  const configResult = await readCommonWorkspaceConfig()
  if (!configResult.ok) return false

  const parsed = parseCommonWorkspaceConfig(configResult.content)
  if (!parsed.ok) return false

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) return false

  const agentsFile = await readConfigRepoFile('AGENTS.md')
  if (!agentsFile.ok) return false

  return Boolean(agentsFile.content.trim())
}

async function isKbReady(): Promise<boolean> {
  return contentRepoPathsExist(REQUIRED_KB_PATHS)
}

export async function getKickstartStatus(
  options?: GetKickstartStatusOptions
): Promise<KickstartStatus> {
  if (!options?.ignoreLock) {
    const locked = await isKickstartApplyLocked()
    if (locked) return 'setup_in_progress'
  }

  const [configReady, kbReady] = await Promise.all([isConfigReady(), isKbReady()])
  if (!configReady || !kbReady) {
    return 'needs_setup'
  }

  return 'ready'
}
