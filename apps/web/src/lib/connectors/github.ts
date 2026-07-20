const GITHUB_PAT_PATTERN = /^(?:ghp_|github_pat_)\S+$/
const GITHUB_PINNED_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/
const GITHUB_MCP_DEFAULT_HOST = 'https://api.githubcopilot.com'

export const DEFAULT_GITHUB_TOOLSETS = ['repos', 'git'] as const

const GITHUB_TOOLSETS = new Set<string>(DEFAULT_GITHUB_TOOLSETS)

export type GithubConnectorConfig = {
  pat: string
  host?: string
  pinnedRepos: string[]
  toolsets: string[]
}

export type GithubConnectorConfigParseResult =
  | { ok: true; config: GithubConnectorConfig }
  | { ok: false }

export function isGithubPat(value: string): boolean {
  return GITHUB_PAT_PATTERN.test(value.trim())
}

export function isGithubPinnedRepo(value: string): boolean {
  return GITHUB_PINNED_REPO_PATTERN.test(value.trim())
}

function parseGithubHost(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) return undefined

  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined
    }

    return url.origin
  } catch {
    return undefined
  }
}

function parseToolsets(value: unknown): string[] | null {
  if (value === undefined) return [...DEFAULT_GITHUB_TOOLSETS]
  if (!Array.isArray(value) || value.length === 0) return null

  const toolsets = value.map((toolset) =>
    typeof toolset === 'string' ? toolset.trim() : ''
  )
  if (
    toolsets.some((toolset) => !GITHUB_TOOLSETS.has(toolset)) ||
    new Set(toolsets).size !== toolsets.length
  ) {
    return null
  }

  return toolsets
}

export function parseGithubConnectorConfig(
  config: Record<string, unknown>
): GithubConnectorConfigParseResult {
  const pat = typeof config.pat === 'string' ? config.pat.trim() : ''
  if (!isGithubPat(pat)) return { ok: false }

  if (!Array.isArray(config.pinnedRepos)) return { ok: false }
  const pinnedRepos = config.pinnedRepos.map((repo) =>
    typeof repo === 'string' ? repo.trim() : ''
  )
  if (pinnedRepos.some((repo) => !isGithubPinnedRepo(repo))) return { ok: false }

  const host = parseGithubHost(config.host)
  if (config.host !== undefined && !host) return { ok: false }

  const toolsets = parseToolsets(config.toolsets)
  if (!toolsets) return { ok: false }

  return {
    ok: true,
    config: {
      pat,
      ...(host ? { host } : {}),
      pinnedRepos: Array.from(new Set(pinnedRepos)),
      toolsets,
    },
  }
}

export function getGithubMcpServerUrl(config: GithubConnectorConfig): string {
  return `${config.host ?? GITHUB_MCP_DEFAULT_HOST}/mcp/`
}

export function getGithubMcpHeaders(config: GithubConnectorConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.pat}`,
    'X-MCP-Readonly': 'true',
    'X-MCP-Toolsets': config.toolsets.join(','),
  }
}

export function getGithubConnectionTestEndpoint(config: Record<string, unknown>): string | null {
  const parsed = parseGithubConnectorConfig(config)
  if (!parsed.ok) return null

  return parsed.config.host
    ? `${parsed.config.host}/api/v3/user`
    : 'https://api.github.com/user'
}
