import { describe, expect, it } from 'vitest'

import { withLinkedRepositories } from '@/lib/spawner/runtime-config-utils'

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
