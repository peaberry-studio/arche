import { DEFAULT_HEALTH_TIMEOUT_MS, getInstanceBasicAuth, getInstanceUrl } from '@/lib/harness/adapters/opencode-v1/client'
import { getProviderSyncHashForUser as getV1ProviderSyncHashForUser } from '@/lib/harness/adapters/opencode-v1/providers'
import { createOpenCodeV1Runtime } from '@/lib/harness/adapters/opencode-v1/runtime'
import { renderRuntimeConfig as renderV1RuntimeConfig } from '@/lib/harness/adapters/opencode-v1/runtime-config'
import {
  listWorkspaceFiles as listV1WorkspaceFiles,
  readWorkspaceFile as readV1WorkspaceFile,
  searchWorkspaceFiles as searchV1WorkspaceFiles,
} from '@/lib/harness/adapters/opencode-v1/workspace-files'
import {
  buildWorkspacePromptParts as buildV1WorkspacePromptParts,
  normalizeContextPaths as normalizeV1ContextPaths,
  normalizeMessageAttachments as normalizeV1MessageAttachments,
} from '@/lib/harness/adapters/opencode-v1/workspace-prompt'
import { renderRuntimeConfig as renderV2RuntimeConfig } from '@/lib/harness/adapters/opencode-v2/runtime-config'
import type { HarnessHealthOptions, HarnessProviderAccessInput, HarnessRuntime } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import type { RuntimeConfigModel, RuntimeConfigRenderResult } from '@/lib/harness/runtime-config'
import { instanceService } from '@/lib/services'
import type { WorkspaceFileContent, WorkspaceFileNode } from '@/types/workspace'

export { DEFAULT_HEALTH_TIMEOUT_MS }

export function renderRuntimeConfig(kind: string | null, model: RuntimeConfigModel): RuntimeConfigRenderResult {
  if (kind === null || kind === 'opencode-v1') return renderV1RuntimeConfig(model)
  if (kind === 'opencode-v2') return renderV2RuntimeConfig(model)
  return { ok: false, error: { code: 'runtime_config_unsupported', path: 'runtimeKind', message: kind } }
}

export async function listWorkspaceFiles(slug: string, path = ''): Promise<HarnessResult<WorkspaceFileNode[]>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? listV1WorkspaceFiles(slug, path) : runtime
}

export async function readWorkspaceFile(slug: string, path: string): Promise<HarnessResult<WorkspaceFileContent>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? readV1WorkspaceFile(slug, path) : runtime
}

export async function searchWorkspaceFiles(slug: string, query: string): Promise<HarnessResult<string[]>> {
  const runtime = await getRuntimeForSlug(slug)
  return runtime.ok ? searchV1WorkspaceFiles(slug, query) : runtime
}

export function getRuntimeForKind(slug: string, kind: string | null = null): HarnessResult<HarnessRuntime> {
  if (kind !== null && kind !== 'opencode-v1') return harnessFailure('runtime_unsupported', kind)
  return { ok: true, data: createOpenCodeV1Runtime(slug) }
}

export async function getRuntimeForSlug(slug: string): Promise<HarnessResult<HarnessRuntime>> {
  try {
    const instance = await instanceService.findRuntimeKindBySlug(slug)
    return getRuntimeForKind(slug, instance?.runtimeKind ?? null)
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

export async function getProviderSyncHashForUser(userId: string): Promise<string> {
  return getV1ProviderSyncHashForUser(userId)
}

export const buildWorkspacePromptParts = buildV1WorkspacePromptParts
export const normalizeContextPaths = normalizeV1ContextPaths
export const normalizeMessageAttachments = normalizeV1MessageAttachments

export async function getRuntimeConnection(slug: string): Promise<{ baseUrl: string; authHeader: string } | null> {
  return getInstanceBasicAuth(slug)
}

export function getRuntimeBaseUrl(slug: string, overrideBaseUrl?: string): string {
  return getInstanceUrl(slug, overrideBaseUrl)
}
