import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'

import { createInstanceClient, normalizeOpenCodeError } from '@/lib/harness/adapters/opencode-v2/client'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { isHiddenWorkspacePath, isProtectedWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-paths'
import type { WorkspaceFileContent, WorkspaceFileNode } from '@/types/workspace'

const INVENTORY_LIMIT = 10000

function safePath(path: string): string | null {
  if (isAbsolute(path) || path.includes('\\') || path.includes('\0')) return null
  const normalized = normalizeWorkspacePath(path)
  if (normalized.split('/').some((segment) => segment === '..') || isProtectedWorkspacePath(normalized)) return null
  return normalized
}

export async function listWorkspaceFiles(slug: string, path = ''): Promise<HarnessResult<WorkspaceFileNode[]>> {
  const safe = safePath(path)
  if (safe === null) return harnessFailure('runtime_error', 'protected_path')
  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    // V2 list includes ignored entries; find supplies the ignore-aware inventory.
    const result = await client.file.find({ query: '', limit: INVENTORY_LIMIT })
    if (result.data.length >= INVENTORY_LIMIT) return harnessFailure('runtime_error', 'workspace_file_limit_exceeded')
    const parent = safe || '.'
    return { ok: true, data: result.data.flatMap((entry) => {
      const path = entry.path.replace(/\/$/, '')
      if (!path || path === '/' || isAbsolute(path) || isHiddenWorkspacePath(path) || dirname(path) !== parent) return []
      return [{ id: path, name: basename(path), path, type: entry.type }]
    }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1) }
  } catch (error) { return normalizeOpenCodeError(error) }
}

export async function readWorkspaceFile(slug: string, path: string): Promise<HarnessResult<WorkspaceFileContent>> {
  const safe = safePath(path)
  if (!safe) return harnessFailure('runtime_error', 'protected_path')
  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    const location = await client.location.get()
    const absolute = resolve(location.directory, safe)
    if (!absolute.startsWith(`${location.directory}${sep}`)) return harnessFailure('runtime_error', 'protected_path')
    const content = await client.file.read({ location: { directory: location.directory }, path: absolute })
    return { ok: true, data: { path: safe, content: Buffer.from(content).toString('utf8'), type: 'raw' } }
  } catch (error) { return normalizeOpenCodeError(error) }
}

export async function searchWorkspaceFiles(slug: string, query: string): Promise<HarnessResult<string[]>> {
  try {
    const client = await createInstanceClient(slug)
    if (!client) return harnessFailure('instance_unavailable')
    const result = await client.file.find({ query, type: 'file', limit: 50 })
    return { ok: true, data: result.data.flatMap((entry) => {
      const path = safePath(entry.path)
      return path && !isHiddenWorkspacePath(path) ? [path] : []
    }).slice(0, 50) }
  } catch (error) { return normalizeOpenCodeError(error) }
}
