import { describe, expect, it } from 'vitest'

import type { WorkspaceFileNode } from '@/lib/opencode/types'
import {
  flattenWorkspaceFileNodes,
  getWorkspacePathBasename,
  rankWorkspaceFileSearchCandidates,
  resolveWorkspaceFilePath,
} from '@/lib/workspace-file-search'

const fileNodes: WorkspaceFileNode[] = [
  {
    id: 'Company',
    name: 'Company',
    path: 'Company',
    type: 'directory',
    children: [
      {
        id: 'Company/Product Strategy.md',
        name: 'Product Strategy.md',
        path: 'Company/Product Strategy.md',
        type: 'file',
      },
      {
        id: 'Company/Research/Customer Interviews.md',
        name: 'Customer Interviews.md',
        path: 'Company/Research/Customer Interviews.md',
        type: 'file',
      },
    ],
  },
]

describe('workspace file search', () => {
  it('flattens nested file nodes', () => {
    expect(flattenWorkspaceFileNodes(fileNodes)).toEqual([
      { name: 'Product Strategy.md', path: 'Company/Product Strategy.md' },
      { name: 'Customer Interviews.md', path: 'Company/Research/Customer Interviews.md' },
    ])
  })

  it('gets the basename for workspace paths', () => {
    expect(getWorkspacePathBasename('Deep/Vault/Roadmap.md')).toBe('Roadmap.md')
    expect(getWorkspacePathBasename('README.md')).toBe('README.md')
    expect(getWorkspacePathBasename('Deep/Vault/')).toBe('Vault')
  })

  it('ranks fuzzy local and remote file matches', () => {
    expect(rankWorkspaceFileSearchCandidates({
      files: flattenWorkspaceFileNodes(fileNodes),
      limit: 10,
      query: 'prd strat',
      remotePaths: ['Deep/Vault/Roadmap.md'],
    })).toEqual([
      { name: 'Product Strategy.md', path: 'Company/Product Strategy.md' },
    ])
  })

  it('deduplicates remote paths already present locally', () => {
    expect(rankWorkspaceFileSearchCandidates({
      files: flattenWorkspaceFileNodes(fileNodes),
      limit: 10,
      query: 'customer',
      remotePaths: ['Company/Research/Customer Interviews.md'],
    })).toEqual([
      { name: 'Customer Interviews.md', path: 'Company/Research/Customer Interviews.md' },
    ])
  })

  it('resolves workspace file paths against the known tree', () => {
    const available = [
      'Company/Product Strategy.md',
      'Company/Research/Customer Interviews.md',
    ]

    expect(resolveWorkspaceFilePath('', available)).toBe('')
    expect(resolveWorkspaceFilePath('Company/Product Strategy.md', available)).toBe(
      'Company/Product Strategy.md',
    )
    expect(resolveWorkspaceFilePath('/Company/Product Strategy.md', available)).toBe(
      'Company/Product Strategy.md',
    )
    expect(resolveWorkspaceFilePath('./Company/Research/Customer Interviews.md', available)).toBe(
      'Company/Research/Customer Interviews.md',
    )
    expect(
      resolveWorkspaceFilePath('/tmp/workspace/Company/Product Strategy.md', available),
    ).toBe('Company/Product Strategy.md')
    expect(resolveWorkspaceFilePath('missing.md', available)).toBe('missing.md')
  })
})
