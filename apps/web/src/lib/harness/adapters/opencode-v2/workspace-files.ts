import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'

import { createInstanceClient, normalizeOpenCodeError } from '@/lib/harness/adapters/opencode-v2/client'
import { harnessFailure, type HarnessResult } from '@/lib/harness/errors'
import { isHiddenWorkspacePath, isProtectedWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-paths'
import type { WorkspaceFileContent, WorkspaceFileNode } from '@/types/workspace'

const INVENTORY_LIMIT = 10000
// One tree load lists every directory; they share one inventory per type.
const INVENTORY_TTL_MS = 2_000

type OpenCodeClient = NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
type Inventory = { files: Set<string> | null; directories: Set<string> | null }

const inventories = new Map<string, { expiresAt: number; inventory: Promise<Inventory> }>()

function entryPath(path: string): string {
  return path.replace(/\/$/, '')
}

// A type whose inventory reached the bound is incomplete (null): its entries
// are not filtered, so a large workspace shows ignored entries instead of none.
async function findInventory(client: OpenCodeClient, type: 'file' | 'directory'): Promise<Set<string> | null> {
  const result = await client.file.find({ query: '', type, limit: INVENTORY_LIMIT })
  return result.data.length >= INVENTORY_LIMIT ? null : new Set(result.data.map((entry) => entryPath(entry.path)))
}

function getInventory(slug: string, client: OpenCodeClient): Promise<Inventory> {
  const cached = inventories.get(slug)
  if (cached && cached.expiresAt > Date.now()) return cached.inventory
  const inventory = Promise.all([findInventory(client, 'file'), findInventory(client, 'directory')])
    .then(([files, directories]) => ({ files, directories }))
  inventories.set(slug, { expiresAt: Date.now() + INVENTORY_TTL_MS, inventory })
  inventory.catch(() => { if (inventories.get(slug)?.inventory === inventory) inventories.delete(slug) })
  return inventory
}

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
    // V2 list is complete for one directory but includes ignored entries;
    // find supplies the ignore-aware inventory used to filter them.
    const location = await client.location.get()
    const [listing, inventory] = await Promise.all([
      client.file.list({ location: { directory: location.directory }, path: safe ? resolve(location.directory, safe) : location.directory }),
      getInventory(slug, client),
    ])
    const parent = safe || '.'
    return { ok: true, data: listing.data.flatMap((entry) => {
      const path = entryPath(entry.path)
      if (!path || path === '/' || isAbsolute(path) || isHiddenWorkspacePath(path) || dirname(path) !== parent) return []
      const known = entry.type === 'directory' ? inventory.directories : inventory.files
      if (known && !known.has(path)) return []
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
