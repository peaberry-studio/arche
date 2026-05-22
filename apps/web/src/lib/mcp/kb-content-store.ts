import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import {
  cleanupClone,
  cloneRepoToTemp,
  detectDefaultBranch,
  hasBareRepoLayout,
  isGitAvailable,
  resolveRepoRoot,
  runGit,
} from '@/lib/git/bare-repo'
import { getKbContentRoot } from '@/lib/runtime/paths'

type KbReadError = 'invalid_path' | 'kb_unavailable' | 'not_found' | 'read_failed'
type KbWriteError = 'article_exists' | 'invalid_path' | 'kb_unavailable' | 'not_found' | 'write_failed'

type CloneContext = {
  repoDir: string
  gitEnv: NodeJS.ProcessEnv
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const GIT_CONTROL_FILES = new Set(['.git', '.gitattributes', '.gitignore', '.gitmodules'])

export type KbArticleListItem = {
  path: string
  size: number
}

export type KbSearchMatch = {
  path: string
  line: number
  text: string
}

export function normalizeKbPath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.startsWith('/')) return null
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) return null

  const segments = trimmed.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) return null
  if (segments.some((segment) => isUnsafeSegment(segment))) return null

  const normalized = path.posix.normalize(segments.join('/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../')) return null

  return normalized
}

export function normalizeKbArticlePath(value: string): string | null {
  const normalized = normalizeKbPath(value)
  if (!normalized || normalized.endsWith('/') || !normalized.toLowerCase().endsWith('.md')) {
    return null
  }

  return normalized
}

export async function listKbArticles(input: { path?: string } = {}): Promise<
  | { ok: true; articles: KbArticleListItem[] }
  | { ok: false; error: KbReadError }
> {
  return readContentRepo(async ({ repoDir }) => {
    let basePath = ''
    if (input.path) {
      const normalizedPath = normalizeKbPath(input.path)
      if (normalizedPath === null) return { ok: false, error: 'invalid_path' }
      basePath = normalizedPath
    }

    let rootPath = repoDir
    if (basePath) {
      const resolved = await resolveSafeExistingPath(repoDir, basePath)
      if (!resolved.ok) return resolved
      rootPath = resolved.path
    }

    const stats = await fs.lstat(rootPath).catch(() => null)
    if (!stats) return { ok: false, error: 'not_found' }

    const articles = stats.isDirectory()
      ? await listMarkdownFiles(repoDir, rootPath, basePath)
      : stats.isFile() && Boolean(basePath) && basePath.toLowerCase().endsWith('.md')
        ? [{ path: basePath, size: stats.size }]
        : []

    return { ok: true, articles }
  })
}

export async function readKbArticle(input: { path: string; maxLines?: number }): Promise<
  | { ok: true; path: string; content: string; truncated: boolean }
  | { ok: false; error: KbReadError }
> {
  const articlePath = normalizeKbArticlePath(input.path)
  if (!articlePath) return { ok: false, error: 'invalid_path' }

  return readContentRepo(async ({ repoDir }) => {
    const resolved = await resolveSafeExistingPath(repoDir, articlePath)
    if (!resolved.ok) return resolved

    const content = await fs.readFile(resolved.path, 'utf-8').catch(() => null)
    if (content === null) return { ok: false, error: 'read_failed' }

    const maxLines = input.maxLines && input.maxLines > 0 ? Math.min(input.maxLines, 2000) : 2000
    const lines = content.split('\n')
    const truncated = lines.length > maxLines
    return {
      ok: true,
      path: articlePath,
      content: truncated ? lines.slice(0, maxLines).join('\n') : content,
      truncated,
    }
  })
}

export async function searchKb(input: { query: string; path?: string; limit?: number }): Promise<
  | { ok: true; matches: KbSearchMatch[] }
  | { ok: false; error: KbReadError | 'invalid_query' }
> {
  const query = input.query.trim().toLowerCase()
  if (!query) return { ok: false, error: 'invalid_query' }

  const listResult = await listKbArticles({ path: input.path })
  if (!listResult.ok) return listResult

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const matches: KbSearchMatch[] = []

  for (const article of listResult.articles) {
    if (matches.length >= limit) break

    const readResult = await readKbArticle({ path: article.path })
    if (!readResult.ok) continue

    const lines = readResult.content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(query)) continue
      matches.push({ path: article.path, line: index + 1, text: lines[index].trim() })
      if (matches.length >= limit) break
    }
  }

  return { ok: true, matches }
}

export async function createKbArticle(input: { path: string; content: string }): Promise<
  | { ok: true; path: string }
  | { ok: false; error: KbWriteError }
> {
  return writeKbArticle(input, 'create')
}

export async function updateKbArticle(input: { path: string; content: string }): Promise<
  | { ok: true; path: string }
  | { ok: false; error: KbWriteError }
> {
  return writeKbArticle(input, 'update')
}

export async function deleteKbArticle(input: { path: string }): Promise<
  | { ok: true; path: string }
  | { ok: false; error: KbWriteError }
> {
  const articlePath = normalizeKbArticlePath(input.path)
  if (!articlePath) return { ok: false, error: 'invalid_path' }

  return mutateContentRepo(`Delete KB article ${articlePath}`, async ({ repoDir }) => {
    const resolved = await resolveSafeExistingPath(repoDir, articlePath)
    if (!resolved.ok) return { ok: false, error: mapReadErrorToWriteError(resolved.error) }

    await fs.rm(resolved.path)
    return { ok: true, changedPaths: [articlePath], data: { ok: true, path: articlePath } }
  })
}

async function writeKbArticle(
  input: { path: string; content: string },
  mode: 'create' | 'update'
): Promise<
  | { ok: true; path: string }
  | { ok: false; error: KbWriteError }
> {
  const articlePath = normalizeKbArticlePath(input.path)
  if (!articlePath) return { ok: false, error: 'invalid_path' }

  return mutateContentRepo(
    mode === 'create' ? `Create KB article ${articlePath}` : `Update KB article ${articlePath}`,
    async ({ repoDir }) => {
      const existing = await resolveSafeExistingPath(repoDir, articlePath)
      if (mode === 'create' && existing.ok) return { ok: false, error: 'article_exists' }
      if (mode === 'update' && !existing.ok) {
        return { ok: false, error: mapReadErrorToWriteError(existing.error) }
      }

      const target = await resolveSafeWritePath(repoDir, articlePath)
      if (!target.ok) return target

      await fs.mkdir(path.dirname(target.path), { recursive: true })
      await fs.writeFile(target.path, input.content, 'utf-8')
      return { ok: true, changedPaths: [articlePath], data: { ok: true, path: articlePath } }
    }
  )
}

async function readContentRepo<T extends { ok: boolean }>(reader: (context: CloneContext) => Promise<T>): Promise<T | { ok: false; error: 'kb_unavailable' | 'read_failed' }> {
  const root = await resolveContentRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }
  if (!(await hasBareRepoLayout(root))) return { ok: false, error: 'kb_unavailable' }
  if (!(await isGitAvailable())) return { ok: false, error: 'read_failed' }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) return { ok: false, error: 'read_failed' }

  try {
    return await reader({ repoDir: clone.dir, gitEnv: clone.gitEnv })
  } finally {
    await cleanupClone(clone)
  }
}

async function mutateContentRepo<T extends { ok: boolean }>(
  commitMessage: string,
  mutate: (context: CloneContext) => Promise<
    | { ok: true; changedPaths: string[]; data: T }
    | { ok: false; error: KbWriteError }
  >
): Promise<T | { ok: false; error: KbWriteError }> {
  const root = await resolveContentRepoRoot()
  if (!root) return { ok: false, error: 'kb_unavailable' }
  if (!(await hasBareRepoLayout(root))) return { ok: false, error: 'kb_unavailable' }
  if (!(await isGitAvailable())) return { ok: false, error: 'write_failed' }

  const clone = await cloneRepoToTemp(root)
  if (!clone.ok) return { ok: false, error: 'write_failed' }

  try {
    const result = await mutate({ repoDir: clone.dir, gitEnv: clone.gitEnv })
    if (!result.ok) return result

    const add = await runGit(['add', '-A', '--', ...result.changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!add.ok) return { ok: false, error: 'write_failed' }

    const status = await runGit(['status', '--porcelain', '--', ...result.changedPaths], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!status.ok) return { ok: false, error: 'write_failed' }
    if (!status.stdout.trim()) return result.data

    const commit = await runGit(
      ['-c', 'user.name=Arche MCP', '-c', 'user.email=mcp@arche.local', 'commit', '-m', commitMessage],
      { cwd: clone.dir, env: clone.gitEnv }
    )
    if (!commit.ok) return { ok: false, error: 'write_failed' }

    const branch = await detectDefaultBranch(clone.dir, clone.gitEnv)
    const push = await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], {
      cwd: clone.dir,
      env: clone.gitEnv,
    })
    if (!push.ok) return { ok: false, error: 'write_failed' }

    return result.data
  } finally {
    await cleanupClone(clone)
  }
}

async function resolveContentRepoRoot(): Promise<string | null> {
  return resolveRepoRoot(getKbContentRoot())
}

async function resolveSafeExistingPath(repoDir: string, normalizedPath: string): Promise<
  | { ok: true; path: string }
  | { ok: false; error: 'invalid_path' | 'not_found' | 'read_failed' }
> {
  const resolved = await resolveSafePath(repoDir, normalizedPath, false)
  if (!resolved.ok) return resolved

  const stats = await fs.lstat(resolved.path).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }).catch(() => undefined)

  if (stats === null) return { ok: false, error: 'not_found' }
  if (!stats || stats.isSymbolicLink()) return { ok: false, error: 'invalid_path' }

  const realRoot = await fs.realpath(repoDir).catch(() => repoDir)
  const realTarget = await fs.realpath(resolved.path).catch(() => null)
  if (!realTarget || !isInside(realRoot, realTarget)) return { ok: false, error: 'invalid_path' }

  return { ok: true, path: resolved.path }
}

async function resolveSafeWritePath(repoDir: string, normalizedPath: string): Promise<
  | { ok: true; path: string }
  | { ok: false; error: 'invalid_path' | 'write_failed' }
> {
  const resolved = await resolveSafePath(repoDir, normalizedPath, true)
  if (!resolved.ok) return resolved.error === 'not_found'
    ? { ok: false, error: 'invalid_path' }
    : { ok: false, error: resolved.error === 'read_failed' ? 'write_failed' : resolved.error }

  return { ok: true, path: resolved.path }
}

async function resolveSafePath(repoDir: string, normalizedPath: string, allowMissingLeaf: boolean): Promise<
  | { ok: true; path: string }
  | { ok: false; error: 'invalid_path' | 'not_found' | 'read_failed' }
> {
  const rootReal = await fs.realpath(repoDir).catch(() => repoDir)
  const segments = normalizedPath.split('/')
  let current = rootReal

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index])
    const stats = await fs.lstat(current).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }).catch(() => undefined)

    if (stats === undefined) return { ok: false, error: 'read_failed' }
    if (stats === null) {
      if (allowMissingLeaf && index === segments.length - 1) break
      if (allowMissingLeaf && index < segments.length - 1) continue
      return { ok: false, error: 'not_found' }
    }

    if (stats.isSymbolicLink()) return { ok: false, error: 'invalid_path' }
  }

  const target = path.resolve(rootReal, normalizedPath)
  if (!isInside(rootReal, target)) return { ok: false, error: 'invalid_path' }
  return { ok: true, path: target }
}

async function listMarkdownFiles(repoDir: string, rootDir: string, prefix: string): Promise<KbArticleListItem[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => [])
  const articles: KbArticleListItem[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue

    const absolutePath = path.join(rootDir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      articles.push(...await listMarkdownFiles(repoDir, absolutePath, relativePath))
      continue
    }

    if (!entry.isFile() || !relativePath.toLowerCase().endsWith('.md')) continue

    const safePath = await resolveSafeExistingPath(repoDir, relativePath)
    if (!safePath.ok) continue

    const stats = await fs.lstat(safePath.path).catch(() => null)
    if (stats?.isFile()) articles.push({ path: relativePath, size: stats.size })
  }

  return articles
}

function isUnsafeSegment(segment: string): boolean {
  const normalized = segment.toLowerCase()
  return segment === '.' || segment === '..' || GIT_CONTROL_FILES.has(normalized)
}

function mapReadErrorToWriteError(error: 'invalid_path' | 'not_found' | 'read_failed'): KbWriteError {
  return error === 'read_failed' ? 'write_failed' : error
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
