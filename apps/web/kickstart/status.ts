import {
  readCommonWorkspaceConfig,
  readConfigRepoFile,
} from '@/lib/common-workspace-config-store'
import {
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'
import { isKickstartApplyLocked } from '@/kickstart/lock'
import { contentRepoHasTrackedFiles } from '@/kickstart/repositories'
import type { KickstartStatus } from '@/kickstart/types'

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
  return contentRepoHasTrackedFiles()
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
