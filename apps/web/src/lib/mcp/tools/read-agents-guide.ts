import type { RuntimeUser } from '@/lib/runtime/types'
import { readConfigRepoFileBuffer } from '@/lib/config-repo-store'
import { withWorkspaceIdentity } from '@/lib/spawner/runtime-config-utils'

export type ReadAgentsGuideInput = {
  user?: RuntimeUser
}

export type ReadAgentsGuideResult =
  | { ok: true; content: string; hash: string | null }
  | { ok: false; error: 'kb_unavailable' | 'not_found' | 'read_failed' }

export async function readAgentsGuide(
  input: ReadAgentsGuideInput = {}
): Promise<ReadAgentsGuideResult> {
  const result = await readConfigRepoFileBuffer('AGENTS.md')
  if (!result.ok) {
    return result
  }

  const raw = result.content.toString('utf-8')

  return {
    ok: true,
    content: input.user
      ? withWorkspaceIdentity(raw, {
          slug: input.user.slug,
          email: input.user.email,
        })
      : raw,
    hash: result.hash,
  }
}
