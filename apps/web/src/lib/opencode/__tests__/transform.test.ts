import { describe, expect, it } from 'vitest'

import { transformParts } from '@/lib/opencode/transform'

describe('transformParts', () => {
  it('normalizes bigint values before returning UI parts', () => {
    const parts = transformParts([
      {
        type: 'tool',
        callID: 'tool-1',
        tool: 'query_db',
        state: {
          status: 'running',
          input: {
            count: BigInt(2),
            nested: {
              total: BigInt(5),
            },
          },
        },
      },
      {
        type: 'mystery',
        id: 'm-1',
        payload: {
          id: BigInt(9),
        },
      },
    ])

    expect(parts).toEqual([
      {
        type: 'tool',
        id: 'tool-1',
        name: 'query_db',
        state: {
          status: 'running',
          input: {
            count: '2',
            nested: {
              total: '5',
            },
          },
        },
      },
      {
        type: 'unknown',
        originalType: 'mystery',
        data: {
          type: 'mystery',
          id: 'm-1',
          payload: {
            id: '9',
          },
        },
      },
    ])
  })
})
