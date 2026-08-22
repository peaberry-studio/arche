import { describe, expect, it } from 'vitest'

import {
  withLinkedRepositories,
  withWorkspaceKnowledgePolicy,
  withWorkspacePermissionGuards,
} from '@/lib/spawner/runtime-config-utils'

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
      '*.opencode*': 'deny',
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

describe('withWorkspaceKnowledgePolicy', () => {
  it('appends the mandatory Knowledge Base write policy', () => {
    expect(withWorkspaceKnowledgePolicy('# Base instructions')).toBe(
      '# Base instructions\n\n## Knowledge Base write policy\n\n' +
      'This block is mandatory and overrides any earlier instruction.\n\n' +
      '- Chat agents must not write, edit, or delete Knowledge Base files. Do not use `write`, `edit`, or shell redirection to change the vault.\n' +
      '- Persist agent knowledge only with `learning_propose` or by delegating to `knowledge-curator`.\n' +
      '- User edits belong in Explore. They appear under Manual edits and are published from there. They do not go through Proposals.\n'
    )
  })
})
