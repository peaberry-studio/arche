import { describe, expect, it } from 'vitest'

import {
  getGithubConnectionTestEndpoint,
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

  it('parses a GitHub Enterprise host and allowed toolset subset', () => {
    const parsed = parseGithubConnectorConfig({
      pat: 'ghp_example',
      host: 'https://github.example.com/',
      pinnedRepos: ['acme/platform'],
      toolsets: ['repos'],
    })

    expect(parsed).toEqual({
      ok: true,
      config: {
        pat: 'ghp_example',
        host: 'https://github.example.com',
        pinnedRepos: ['acme/platform'],
        toolsets: ['repos'],
      },
    })
  })

  it.each([
    { pat: 'token', pinnedRepos: ['owner/repo'] },
    { pat: 'ghp_example', pinnedRepos: 'owner/repo' },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo/path'] },
    { pat: 'ghp_example', host: 'http://github.example.com', pinnedRepos: ['owner/repo'] },
    { pat: 'ghp_example', host: 'https://github.example.com/api', pinnedRepos: ['owner/repo'] },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo'], toolsets: ['all'] },
    { pat: 'ghp_example', pinnedRepos: ['owner/repo'], toolsets: [] },
  ])('rejects invalid config %#', (config) => {
    expect(parseGithubConnectorConfig(config)).toEqual({ ok: false })
  })

  it('builds MCP and REST test URLs from parsed configuration', () => {
    const githubCom = parseGithubConnectorConfig({
      pat: 'ghp_example',
      pinnedRepos: ['owner/repo'],
    })
    const enterprise = parseGithubConnectorConfig({
      pat: 'ghp_example',
      host: 'https://github.example.com',
      pinnedRepos: ['owner/repo'],
    })

    if (!githubCom.ok || !enterprise.ok) {
      throw new Error('expected valid GitHub connector configurations')
    }

    expect(getGithubMcpServerUrl(githubCom.config)).toBe('https://api.githubcopilot.com/mcp/')
    expect(getGithubMcpServerUrl(enterprise.config)).toBe('https://github.example.com/mcp/')
    expect(getGithubConnectionTestEndpoint({
      pat: 'ghp_example',
      pinnedRepos: ['owner/repo'],
    })).toBe('https://api.github.com/user')
    expect(getGithubConnectionTestEndpoint({
      pat: 'ghp_example',
      host: 'https://github.example.com',
      pinnedRepos: ['owner/repo'],
    })).toBe('https://github.example.com/api/v3/user')
  })
})
