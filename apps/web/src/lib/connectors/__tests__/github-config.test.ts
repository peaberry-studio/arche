import { describe, expect, it } from 'vitest'

import {
  getGithubConnectionTestEndpoint,
  getGithubMcpHeaders,
  getGithubMcpServerUrl,
  parseGithubConnectorConfig,
} from '@/lib/connectors/github'

describe('GitHub connector config', () => {
  it('parses a valid GitHub.com config with restricted default toolsets', () => {
    expect(parseGithubConnectorConfig({
      pat: ' github_pat_example ',
      pinnedRepos: ['owner/repo', 'owner/repo'],
    })).toEqual({
      ok: true,
      config: {
        pat: 'github_pat_example',
        pinnedRepos: ['owner/repo'],
        toolsets: ['repos', 'git'],
      },
    })
  })

  it('parses an allowed toolset subset', () => {
    const parsed = parseGithubConnectorConfig({
      pat: 'ghp_example',
      pinnedRepos: ['acme/platform'],
      toolsets: ['repos'],
    })

    expect(parsed).toEqual({
      ok: true,
      config: {
        pat: 'ghp_example',
        pinnedRepos: ['acme/platform'],
        toolsets: ['repos'],
      },
    })
  })

  it.each([
    { pat: 'token', pinnedRepos: ['owner/repo'] },
    { pat: 'ghp_example', pinnedRepos: 'owner/repo' },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo/path'] },
    { pat: 'ghp_example', host: 'https://github.example.com', pinnedRepos: ['owner/repo'] },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo'], toolsets: ['all'] },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo'], toolsets: [] },
  ])('rejects invalid config %#', (config) => {
    expect(parseGithubConnectorConfig(config)).toEqual({ ok: false })
  })

  it('builds GitHub.com MCP and REST test URLs', () => {
    const githubCom = parseGithubConnectorConfig({
      pat: 'ghp_example',
      pinnedRepos: ['owner/repo'],
    })

    if (!githubCom.ok) {
      throw new Error('expected valid GitHub connector configurations')
    }

    expect(getGithubMcpServerUrl()).toBe('https://api.githubcopilot.com/mcp/')
    expect(getGithubMcpHeaders(githubCom.config)).toEqual({
      Authorization: 'Bearer ghp_example',
      'X-MCP-Readonly': 'true',
      'X-MCP-Toolsets': 'repos,git',
    })
    expect(getGithubConnectionTestEndpoint()).toBe('https://api.github.com/user')
  })
})
