import { createInstanceClient } from '@/lib/harness/adapters/opencode-v1/client'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { isHiddenWorkspacePath, isProtectedWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-paths'
import type { WorkspaceFileContent, WorkspaceFileNode } from '@/types/workspace'

export async function listWorkspaceFiles(slug: string, path = ''): Promise<HarnessResult<WorkspaceFileNode[]>> {
  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    const result = await client.file.list({ path })
    return {
      ok: true,
      data: (result.data ?? [])
        .filter((node) => !node.ignored && !isHiddenWorkspacePath(node.path))
        .map((node) => ({ id: node.path, name: node.name, path: node.path, type: node.type })),
    }
  } catch (error) {
    return harnessFailure('runtime_error', error instanceof Error ? error.message : 'unknown')
  }
}

export async function readWorkspaceFile(slug: string, path: string): Promise<HarnessResult<WorkspaceFileContent>> {
  const safePath = normalizeWorkspacePath(path)
  if (!safePath || safePath.split('/').some((segment) => segment === '..') || isProtectedWorkspacePath(safePath)) {
    return harnessFailure('runtime_error', 'protected_path')
  }

  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    const result = await client.file.read({ path: safePath })
    if (!result.data) return harnessFailure('runtime_error', 'file_not_found')
    const content = result.data.encoding === 'base64'
      ? Buffer.from(result.data.content, 'base64').toString('utf-8')
      : result.data.content
    return { ok: true, data: { path: safePath, content, type: result.data.type === 'text' ? 'raw' : 'patch' } }
  } catch (error) {
    return harnessFailure('runtime_error', error instanceof Error ? error.message : 'unknown')
  }
}

export async function searchWorkspaceFiles(slug: string, query: string): Promise<HarnessResult<string[]>> {
  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    const result = await client.find.files({ query, limit: 50 })
    return { ok: true, data: (result.data ?? []).filter((path) => !isHiddenWorkspacePath(path)) }
  } catch (error) {
    return harnessFailure('runtime_error', error instanceof Error ? error.message : 'unknown')
  }
}
