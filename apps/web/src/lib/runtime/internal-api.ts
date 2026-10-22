import { getModelsCatalogToken } from '@/lib/providers/models-catalog-token'
import { getDesktopInternalApiRoot } from '@/lib/runtime/desktop/config'
import { isDesktop } from '@/lib/runtime/mode'
import { WEB_INTERNAL_API_ROOT } from '@/lib/spawner/runtime-config'

// Address of this server's internal API as seen from the workspace runtime.
export function getRuntimeInternalApiRoot(): string {
  return isDesktop() ? getDesktopInternalApiRoot() : WEB_INTERNAL_API_ROOT
}

export function getRuntimeModelsCatalogUrl(): string {
  return `${getRuntimeInternalApiRoot()}/models/${getModelsCatalogToken()}`
}

// No route serves this path: OpenCode 2 reads the 404 as "no Console config",
// so Zen credentials never reach the OpenCode Console.
export function getRuntimeOpencodeConsoleUrl(): string {
  return `${getRuntimeInternalApiRoot()}/opencode-console`
}
