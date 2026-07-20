const GITHUB_PAT_PATTERN = /^(?:ghp_|github_pat_)\S+$/
const GITHUB_PINNED_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/
const GITHUB_MCP_SERVER_URL = 'https://api.githubcopilot.com/mcp/'
const GITHUB_CONNECTION_TEST_ENDPOINT = 'https://api.github.com/user'

export const DEFAULT_GITHUB_TOOLSETS = ['repos', 'git'] as const

const GITHUB_TOOLSETS = new Set<string>(DEFAULT_GITHUB_TOOLSETS)

export type GithubConnectorConfig = {
  pat: string
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

  if (config.host !== undefined) return { ok: false }

  const toolsets = parseToolsets(config.toolsets)
  if (!toolsets) return { ok: false }

  return {
    ok: true,
    config: {
      pat,
      pinnedRepos: Array.from(new Set(pinnedRepos)),
      toolsets,
    },
  }
}

export function getGithubMcpServerUrl(): string {
  return GITHUB_MCP_SERVER_URL
}

export function getGithubMcpHeaders(config: GithubConnectorConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.pat}`,
    'X-MCP-Readonly': 'true',
    'X-MCP-Toolsets': config.toolsets.join(','),
  }
}

export function getGithubConnectionTestEndpoint(): string {
  return GITHUB_CONNECTION_TEST_ENDPOINT
}
