import { getDesktopProviderGatewayConfig } from '@/lib/runtime/desktop/config'
import { isDesktop } from '@/lib/runtime/mode'
import { userService } from '@/lib/services'
import {
  buildWorkspaceRuntimeArtifacts,
  getWebProviderGatewayConfig,
  hashWorkspaceRuntimeArtifacts,
} from '@/lib/spawner/runtime-artifacts'

export type RuntimeConfigHashResult =
  | { ok: true; hash: string }
  | { ok: false; error: string }

export async function getRuntimeConfigHashForSlug(slug: string): Promise<RuntimeConfigHashResult> {
  try {
    const user = await userService.findIdBySlug(slug)
    if (!user) {
      return { ok: false, error: 'user_not_found' }
    }

    const artifacts = await buildWorkspaceRuntimeArtifacts(
      slug,
      isDesktop() ? getDesktopProviderGatewayConfig() : getWebProviderGatewayConfig()
    )

    return { ok: true, hash: hashWorkspaceRuntimeArtifacts(artifacts) }
  } catch {
    return { ok: false, error: 'read_failed' }
  }
}
