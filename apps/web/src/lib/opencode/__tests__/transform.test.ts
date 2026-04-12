import { describe, expect, it } from 'vitest'

import { transformParts } from '@/lib/opencode/transform'

const ISSUE_116_ERROR =
  'The user has specified a rule which prevents you from using this specific tool call. ' +
  'Here are some of the relevant rules ' +
  '[{"permission":"*","pattern":"*","action":"allow"},{"permission":"task","pattern":"*","action":"allow"},{"permission":"task","pattern":"*","action":"deny"}]'

describe('transformParts', () => {
  it('drops nested task delegation permission failures from persisted parts', () => {
    const result = transformParts([
      {
        type: 'tool',
        id: 'tool-1',
        tool: 'task',
        state: {
          status: 'error',
          input: {
            subagent_type: 'seo',
            description: 'Draft SEO strategy',
          },
          error: ISSUE_116_ERROR,
        },
      },
    ])

    expect(result).toEqual([])
    expect(JSON.stringify(result)).not.toContain('The user has specified a rule')
  })

  it('preserves unrelated tool permission failures', () => {
    const result = transformParts([
      {
        type: 'tool',
        id: 'tool-1',
        tool: 'bash',
        state: {
          status: 'error',
          input: {},
          error: "tool 'bash' denied",
        },
      },
    ])

    expect(result).toEqual([
      {
        type: 'tool',
        id: 'tool-1',
        name: 'bash',
        state: {
          status: 'error',
          input: {},
          error: "tool 'bash' denied",
        },
      },
    ])
  })
})
