import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles } from '@/lib/harness/adapters/opencode-v2/workspace-files'

const mocks = vi.hoisted(() => ({ client: vi.fn(), find: vi.fn(), list: vi.fn(), read: vi.fn(), location: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v2/client', () => ({
  createInstanceClient: mocks.client,
  normalizeOpenCodeError: (error: Error) => ({ ok: false, error: { code: 'runtime_error', detail: error.message } }),
}))

describe('V2 workspace files bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.client.mockResolvedValue({ file: { find: mocks.find, list: mocks.list, read: mocks.read }, location: { get: mocks.location } })
    mocks.location.mockResolvedValue({ directory: '/workspace' })
  })

  // The adapter caches one inventory per workspace for a tree load, so every
  // test uses its own workspace slug.
  function inventory(files: string[], directories: string[]) {
    mocks.find.mockImplementation(async ({ type }: { type: 'file' | 'directory' }) => ({
      data: (type === 'file' ? files : ['/', ...directories.map((path) => `${path}/`)]).map((path) => ({ path, type })),
    }))
  }
  function listing(entries: Record<string, { path: string; type: 'file' | 'directory' }[]>) {
    mocks.list.mockImplementation(async ({ path }: { path: string }) => ({ data: entries[path] ?? [] }))
  }

  it('lists one directory and hides entries the ignore-aware inventory leaves out', async () => {
    inventory(['hello.txt', 'nested/child.txt', '.gitignore'], ['nested'])
    listing({
      '/workspace': [
        { path: '.git/', type: 'directory' }, { path: 'ignored-dir/', type: 'directory' }, { path: 'nested/', type: 'directory' },
        { path: 'hello.txt', type: 'file' }, { path: 'ignored.txt', type: 'file' },
      ],
      '/workspace/nested': [{ path: 'nested/child.txt', type: 'file' }],
    })
    expect(await listWorkspaceFiles('ignore-aware')).toEqual({ ok: true, data: [
      { id: 'nested', name: 'nested', path: 'nested', type: 'directory' },
      { id: 'hello.txt', name: 'hello.txt', path: 'hello.txt', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('ignore-aware', 'nested')).toEqual({ ok: true, data: [
      { id: 'nested/child.txt', name: 'child.txt', path: 'nested/child.txt', type: 'file' },
    ] })
    expect(mocks.list).toHaveBeenCalledWith({ location: { directory: '/workspace' }, path: '/workspace/nested' })
  })

  it('still loads the tree of a workspace with 10,000 or more files', async () => {
    inventory(Array.from({ length: 10000 }, (_, index) => `file-${index}`), ['docs'])
    listing({ '/workspace': [
      { path: 'docs/', type: 'directory' }, { path: 'node_modules/', type: 'directory' },
      { path: 'file-1', type: 'file' }, { path: 'not-in-the-truncated-inventory.txt', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('large-workspace')).toEqual({ ok: true, data: [
      { id: 'docs', name: 'docs', path: 'docs', type: 'directory' },
      { id: 'file-1', name: 'file-1', path: 'file-1', type: 'file' },
      { id: 'not-in-the-truncated-inventory.txt', name: 'not-in-the-truncated-inventory.txt', path: 'not-in-the-truncated-inventory.txt', type: 'file' },
    ] })
  })

  it('reuses one inventory across the directories of a tree load and refreshes it afterwards', async () => {
    vi.useFakeTimers()
    try {
      inventory(['a/one.txt', 'b/two.txt'], ['a', 'b'])
      listing({ '/workspace': [{ path: 'a/', type: 'directory' }, { path: 'b/', type: 'directory' }] })
      await listWorkspaceFiles('tree-load')
      await listWorkspaceFiles('tree-load', 'a')
      await listWorkspaceFiles('tree-load', 'b')
      expect(mocks.find).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(2_001)
      await listWorkspaceFiles('tree-load')
      expect(mocks.find).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('decodes native V2 byte reads', async () => {
    mocks.read.mockResolvedValue(new TextEncoder().encode('hello v2\n'))
    expect(await readWorkspaceFile('alice', 'hello.txt')).toEqual({ ok: true, data: { path: 'hello.txt', content: 'hello v2\n', type: 'raw' } })
    expect(mocks.read).toHaveBeenCalledWith({ location: { directory: '/workspace' }, path: '/workspace/hello.txt' })
  })

  it.each(['../outside', '/outside', '.git/config', 'foo/../../outside', 'foo\\..\\outside'])('rejects unsafe read/list path %s before transport', async (path) => {
    expect((await readWorkspaceFile('alice', path)).ok).toBe(false)
    expect((await listWorkspaceFiles('alice', path)).ok).toBe(false)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('keeps fuzzy search bounded and filters protected results', async () => {
    mocks.find.mockResolvedValue({ data: [{ path: 'hello.txt', type: 'file' }, { path: '.git/config', type: 'file' }, { path: '../outside', type: 'file' }] })
    expect(await searchWorkspaceFiles('alice', 'hlo')).toEqual({ ok: true, data: ['hello.txt'] })
    expect(mocks.find).toHaveBeenCalledWith({ query: 'hlo', type: 'file', limit: 50 })
  })
})
