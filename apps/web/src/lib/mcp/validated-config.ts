import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import {
  type CommonWorkspaceConfig,
  parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'

export type WorkspaceConfigError = 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed'

export type ValidatedWorkspaceConfigResult =
  | { ok: true; config: CommonWorkspaceConfig; hash: string }
  | { ok: false; error: WorkspaceConfigError }

export async function readValidatedWorkspaceConfig(): Promise<ValidatedWorkspaceConfigResult> {
  const result = await readCommonWorkspaceConfig()
  if (!result.ok) {
    return result
  }

  const parsed = parseCommonWorkspaceConfig(result.content)
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  return {
    ok: true,
    config: parsed.config,
    hash: result.hash,
  }
}
