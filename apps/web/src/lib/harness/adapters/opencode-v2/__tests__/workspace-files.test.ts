import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles } from '@/lib/harness/adapters/opencode-v2/workspace-files'

const mocks = vi.hoisted(() => ({ client: vi.fn(), find: vi.fn(), read: vi.fn(), location: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v2/client', () => ({
  createInstanceClient: mocks.client,
  normalizeOpenCodeError: (error: Error) => ({ ok: false, error: { code: 'runtime_error', detail: error.message } }),
}))

describe('V2 workspace files bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.client.mockResolvedValue({ file: { find: mocks.find, read: mocks.read }, location: { get: mocks.location } })
    mocks.location.mockResolvedValue({ directory: '/workspace' })
  })

  it('uses the recorded ignore-aware inventory rather than unfiltered V2 list', async () => {
    mocks.find.mockResolvedValue({ data: [
      { path: '/', type: 'directory' }, { path: 'nested/', type: 'directory' },
      { path: 'hello.txt', type: 'file' }, { path: 'nested/child.txt', type: 'file' },
      { path: '.opencode/opencode.json', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: true, data: [
      { id: 'nested', name: 'nested', path: 'nested', type: 'directory' },
      { id: 'hello.txt', name: 'hello.txt', path: 'hello.txt', type: 'file' },
    ] })
    expect(await listWorkspaceFiles('alice', 'nested')).toEqual({ ok: true, data: [
      { id: 'nested/child.txt', name: 'child.txt', path: 'nested/child.txt', type: 'file' },
    ] })
  })

  it('refuses an incomplete inventory instead of silently hiding entries', async () => {
    mocks.find.mockResolvedValue({ data: Array.from({ length: 10000 }, (_, i) => ({ path: `file-${i}`, type: 'file' })) })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: false, error: { code: 'runtime_error', detail: 'workspace_file_limit_exceeded' } })
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
