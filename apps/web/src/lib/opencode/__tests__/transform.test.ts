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

  it('extracts attachment paths from local desktop file URLs', () => {
    const parts = transformParts([
      {
        type: 'file',
        id: 'file-1',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])

    expect(parts).toEqual([
      {
        type: 'file',
        id: 'file-1',
        path: '.arche/attachments/photo.jpg',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])
  })

  it('prefers canonical file paths over absolute file URLs', () => {
    const parts = transformParts([
      {
        type: 'file',
        id: 'file-2',
        path: '.arche/attachments/photo.jpg',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])

    expect(parts).toEqual([
      {
        type: 'file',
        id: 'file-2',
        path: '.arche/attachments/photo.jpg',
        filename: 'photo.jpg',
        url: 'file:///Users/alice/Arche/workspace/.arche/attachments/photo.jpg',
      },
    ])
  })
})
