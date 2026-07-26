import { describe, expect, it } from 'vitest'

import { withLinkedRepositories, withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'

describe('withWorkspacePermissionGuards', () => {
  it('overrides workspace attempts to permit OpenCode configuration edits and shell commands', () => {
    const config = withWorkspacePermissionGuards({
      permission: {
        bash: 'ask',
        edit: {
          '**/.opencode/**': 'allow',
          'notes/**': 'allow',
        },
      },
    })
    const permission = config.permission as {
      bash: Record<string, string>
      edit: Record<string, string>
    }

    expect(permission.edit).toMatchObject({
      '.opencode': 'deny',
      '.opencode/**': 'deny',
      '**/.opencode': 'deny',
      '**/.opencode/**': 'deny',
      'notes/**': 'allow',
    })
    expect(permission.bash).toMatchObject({
      '*': 'ask',
      '*.opencode': 'deny',
      '*.opencode/*': 'deny',
    })
  })
})

describe('withLinkedRepositories', () => {
  it('returns the original instructions when no repositories are linked', () => {
    expect(withLinkedRepositories('# Base instructions', [])).toBe('# Base instructions')
  })

  it('appends linked repository guidance and the pinned repositories', () => {
    expect(withLinkedRepositories('# Base instructions', ['acme/api', 'acme/web'])).toBe(
      '# Base instructions\n\n## Linked Repositories\n\n' +
      'You have GitHub MCP tools (`get_file_contents`, `search_code`, `list_commits`, `get_commit`) to query these repositories. Use `main` unless correlating across branches.\n\n' +
      '- `acme/api`\n- `acme/web`\n'
    )
  })
})
