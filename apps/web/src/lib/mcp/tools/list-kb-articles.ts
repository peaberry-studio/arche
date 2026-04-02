import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { normalizeKbPath } from '@/lib/mcp/tools/path'
import { getKbContentRoot } from '@/lib/runtime/paths'

export type ListKbArticlesInput = {
  path?: string
}

export type ListKbArticlesResult =
  | { ok: true; entries: KbArticleTreeEntry[] }
  | { ok: false; error: 'invalid_path' | 'kb_unavailable' }

export type KbArticleTreeEntry = {
  name: string
  path: string
  type: 'directory' | 'file'
  children?: KbArticleTreeEntry[]
}

export async function listKbArticles(
  input: ListKbArticlesInput
): Promise<ListKbArticlesResult> {
  const args = ['ls-tree', '-r', '--name-only', 'HEAD']
  let normalizedPath: string | null = null

  if (input.path) {
    normalizedPath = normalizeKbPath(input.path)
    if (!normalizedPath) {
      return { ok: false, error: 'invalid_path' }
    }

    args.push(normalizedPath)
  }

  const result = await runGitOnBareRepo(getKbContentRoot(), args)
  if (!result.ok) {
    return { ok: false, error: 'kb_unavailable' }
  }

  const articles = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return {
    ok: true,
    entries: buildArticleTree(articles, normalizedPath ?? undefined),
  }
}

function buildArticleTree(
  articles: string[],
  scopePath?: string
): KbArticleTreeEntry[] {
  const roots: KbArticleTreeEntry[] = []

  for (const articlePath of articles) {
    const displayPath = scopePath ? stripScopePrefix(articlePath, scopePath) : articlePath
    const segments = displayPath.split('/').filter((segment) => segment.length > 0)

    let cursor = roots
    let parentPath = ''

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const isLeaf = index === segments.length - 1
      const fullPath = parentPath ? `${parentPath}/${segment}` : segment
      const originalPath = scopePath ? `${scopePath}/${fullPath}` : fullPath

      let existing = cursor.find((entry) => entry.name === segment)
      if (!existing) {
        existing = {
          name: segment,
          path: originalPath,
          type: isLeaf ? 'file' : 'directory',
          children: isLeaf ? undefined : [],
        }
        cursor.push(existing)
        sortEntries(cursor)
      }

      if (!isLeaf) {
        existing.type = 'directory'
        existing.children = existing.children ?? []
        cursor = existing.children
      }

      parentPath = fullPath
    }
  }

  return roots
}

function stripScopePrefix(articlePath: string, scopePath: string): string {
  return articlePath.startsWith(`${scopePath}/`)
    ? articlePath.slice(scopePath.length + 1)
    : articlePath
}

function sortEntries(entries: KbArticleTreeEntry[]): void {
  entries.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? 1 : -1
    }

    return left.name.localeCompare(right.name)
  })
}
