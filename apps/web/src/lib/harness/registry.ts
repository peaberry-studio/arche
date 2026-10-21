import { createOpenCodeV1Reader } from '@/lib/harness/adapters/opencode-v1/reader'
import { renderRuntimeConfig as renderV2RuntimeConfig } from '@/lib/harness/adapters/opencode-v2/runtime-config'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import {
  listWorkspaceFiles as listV2WorkspaceFiles,
  readWorkspaceFile as readV2WorkspaceFile,
  searchWorkspaceFiles as searchV2WorkspaceFiles,
} from '@/lib/harness/adapters/opencode-v2/workspace-files'
import type { HarnessHealthOptions, HarnessProviderAccessInput, HarnessRuntime, LegacySessionReader } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { DEFAULT_HEALTH_TIMEOUT_MS, getInstanceBasicAuth, getInstanceUrl } from '@/lib/harness/runtime-connection'
import type { RuntimeConfigModel, RuntimeConfigRenderResult } from '@/lib/harness/runtime-config'
import { instanceService } from '@/lib/services'
import type { WorkspaceFileContent, WorkspaceFileNode } from '@/types/workspace'

export { DEFAULT_HEALTH_TIMEOUT_MS }
export { buildWorkspacePromptParts, normalizeContextPaths, normalizeMessageAttachments } from '@/lib/harness/workspace-prompt'

// The only runtime workspaces start on. `Instance.runtimeKind` records it; a
// null or other value means the workspace has not migrated to it yet.
export const CURRENT_RUNTIME_KIND = 'opencode-v2'
// Instances recorded before the runtime kind existed, or explicitly on OpenCode 1.
export const LEGACY_RUNTIME_KIND = 'opencode-v1'

export function isCurrentRuntimeKind(kind: string | null | undefined): boolean {
  return kind === CURRENT_RUNTIME_KIND
}

export function renderRuntimeConfig(model: RuntimeConfigModel): RuntimeConfigRenderResult {
  return renderV2RuntimeConfig(model)
}

export async function listWorkspaceFiles(slug: string, path = ''): Promise<HarnessResult<WorkspaceFileNode[]>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? listV2WorkspaceFiles(slug, path) : runtime
}

export async function readWorkspaceFile(slug: string, path: string): Promise<HarnessResult<WorkspaceFileContent>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? readV2WorkspaceFile(slug, path) : runtime
}

export async function searchWorkspaceFiles(slug: string, query: string): Promise<HarnessResult<string[]>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? searchV2WorkspaceFiles(slug, query) : runtime
}

export function getRuntime(slug: string): HarnessRuntime {
  return createOpenCodeV2Runtime(slug)
}

export function getLegacySessionReader(slug: string, connection: { baseUrl: string; authHeader: string; signal?: AbortSignal }): LegacySessionReader {
  return createOpenCodeV1Reader(slug, connection)
}

// A workspace still recorded on OpenCode 1 is not served until it restarts and
// migrates; callers see `runtime_unsupported`.
export async function getRuntimeForSlug(slug: string): Promise<HarnessResult<HarnessRuntime>> {
  try {
    const instance = await instanceService.findRuntimeKindBySlug(slug)
    if (instance && !isCurrentRuntimeKind(instance.runtimeKind)) return harnessFailure('runtime_unsupported', instance.runtimeKind ?? LEGACY_RUNTIME_KIND)
    return { ok: true, data: getRuntime(slug) }
  } catch {
    return harnessFailure('instance_unavailable', 'runtime_kind_lookup_failed')
  }
}

export async function checkRuntimeHealth(slug: string, options?: HarnessHealthOptions): Promise<HarnessResult<{ version?: string }>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? runtime.data.health(options) : runtime
}

export async function syncRuntimeProviderAccess(slug: string, input: HarnessProviderAccessInput): Promise<HarnessResult<void>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? runtime.data.syncProviderAccess(input) : runtime
}

export async function getRuntimeConnection(slug: string): Promise<{ baseUrl: string; authHeader: string } | null> {
  return getInstanceBasicAuth(slug)
}

export function getRuntimeBaseUrl(slug: string, overrideBaseUrl?: string): string {
  return getInstanceUrl(slug, overrideBaseUrl)
}
