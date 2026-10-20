import { DEFAULT_HEALTH_TIMEOUT_MS, getInstanceBasicAuth, getInstanceUrl } from '@/lib/harness/adapters/opencode-v1/client'
import { getProviderSyncHashForUser as getV1ProviderSyncHashForUser } from '@/lib/harness/adapters/opencode-v1/providers'
import { createOpenCodeV1Runtime } from '@/lib/harness/adapters/opencode-v1/runtime'
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
import type { HarnessHealthOptions, HarnessProviderAccessInput, HarnessRuntime } from '@/lib/harness/contract'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'

export { DEFAULT_HEALTH_TIMEOUT_MS }

export const listWorkspaceFiles = listV1WorkspaceFiles
export const readWorkspaceFile = readV1WorkspaceFile
export const searchWorkspaceFiles = searchV1WorkspaceFiles

export function getRuntimeForKind(slug: string, kind: string | null = null): HarnessResult<HarnessRuntime> {
  if (kind !== null && kind !== 'opencode-v1') return harnessFailure('runtime_unsupported', kind)
  return { ok: true, data: createOpenCodeV1Runtime(slug) }
}

export async function getRuntimeForSlug(slug: string): Promise<HarnessResult<HarnessRuntime>> {
  return getRuntimeForKind(slug)
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
