import { runGitOnBareRepo } from '@/lib/git/bare-repo'
import { normalizeKbPath } from '@/lib/mcp/tools/path'
import { getKbContentRoot } from '@/lib/runtime/paths'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export type SearchKbInput = {
  query: string
  path?: string
  caseSensitive?: boolean
  limit?: number
}

export type SearchKbMatch = {
  file: string
  line: number
  snippet: string
}

export type SearchKbResult =
  | { ok: true; matches: SearchKbMatch[] }
  | { ok: false; error: 'empty_query' | 'invalid_path' | 'kb_unavailable' }

export async function searchKb(input: SearchKbInput): Promise<SearchKbResult> {
  const query = input.query.trim()
  if (!query) {
    return { ok: false, error: 'empty_query' }
  }

  const args = [
    'grep',
    '-n',
    '-I',
    '-C',
    '3',
    '--max-count',
    String(resolveLimit(input.limit)),
  ]
  if (input.caseSensitive === false) {
    args.push('-i')
  }

  args.push(query, 'HEAD')

  if (input.path) {
    const normalizedPath = normalizeKbPath(input.path)
    if (!normalizedPath) {
      return { ok: false, error: 'invalid_path' }
    }

    args.push('--', normalizedPath)
  }

  const result = await runGitOnBareRepo(getKbContentRoot(), args)
  if (!result.ok) {
    if (!result.stderr.trim()) {
      return { ok: true, matches: [] }
    }

    return { ok: false, error: 'kb_unavailable' }
  }

  return { ok: true, matches: parseGitGrepOutput(result.stdout) }
}

function resolveLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return DEFAULT_LIMIT
  }

  return Math.min(limit, MAX_LIMIT)
}

function parseGitGrepOutput(stdout: string): SearchKbMatch[] {
  return stdout
    .trim()
    .split('\n--\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .flatMap((block) => {
      const firstMatch = block
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^HEAD:.+:\d+:/.test(line))

      if (!firstMatch) {
        return []
      }

      const parsed = parseMatchLine(firstMatch)
      if (!parsed) {
        return []
      }

      return [{ ...parsed, snippet: block }]
    })
}

function parseMatchLine(line: string): Omit<SearchKbMatch, 'snippet'> | null {
  const match = line.match(/^HEAD:(.+):(\d+):(.*)$/)
  if (!match) {
    return null
  }

  return {
    file: match[1],
    line: Number.parseInt(match[2], 10),
  }
}
