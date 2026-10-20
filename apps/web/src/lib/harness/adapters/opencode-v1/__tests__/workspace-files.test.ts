import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles } from '@/lib/harness/adapters/opencode-v1/workspace-files'

const mocks = vi.hoisted(() => ({
  createInstanceClient: vi.fn(), fileList: vi.fn(), fileRead: vi.fn(), findFiles: vi.fn(),
}))
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ createInstanceClient: mocks.createInstanceClient }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.createInstanceClient.mockResolvedValue({
    file: { list: mocks.fileList, read: mocks.fileRead }, find: { files: mocks.findFiles },
  })
})

describe('temporary v1 workspace file forwarding', () => {
  it('filters ignored .env files and hidden paths before returning normalized nodes', async () => {
    mocks.fileList.mockResolvedValue({ data: [
      { path: '.env', name: '.env', type: 'file', ignored: true },
      { path: 'generated', name: 'generated', type: 'directory', ignored: true },
      { path: '.git', name: '.git', type: 'directory', ignored: false },
      { path: 'node_modules', name: 'node_modules', type: 'directory', ignored: false },
      { path: '.arche/config', name: 'config', type: 'file', ignored: false },
      { path: 'opencode.json', name: 'opencode.json', type: 'file', ignored: false },
      { path: 'src', name: 'src', type: 'directory', ignored: false },
      { path: 'README.md', name: 'README.md', type: 'file', ignored: false },
    ] })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: true, data: [
      { id: 'src', path: 'src', name: 'src', type: 'directory' },
      { id: 'README.md', path: 'README.md', name: 'README.md', type: 'file' },
    ] })
    expect(mocks.createInstanceClient).toHaveBeenCalledWith('alice')
    expect(mocks.fileList).toHaveBeenCalledExactlyOnceWith({ path: '' })
  })
  it('forwards a directory path with the original SDK parameters and no recursive options', async () => {
    mocks.fileList.mockResolvedValue({ data: [] })
    expect(await listWorkspaceFiles('alice', 'src')).toEqual({ ok: true, data: [] })
    expect(mocks.fileList).toHaveBeenCalledExactlyOnceWith({ path: 'src' })
  })
  it('preserves fuzzy matching by forwarding the intact query and upstream limit of 50 without scanning directories', async () => {
    const paths = Array.from({ length: 50 }, (_, index) => `src/workspace-session-${index}.ts`)
    mocks.findFiles.mockResolvedValue({ data: paths })
    expect(await searchWorkspaceFiles('alice', 'wSsn')).toEqual({ ok: true, data: paths })
    expect(mocks.findFiles).toHaveBeenCalledExactlyOnceWith({ query: 'wSsn', limit: 50 })
    expect(mocks.fileList).not.toHaveBeenCalled()
    expect(mocks.fileRead).not.toHaveBeenCalled()
  })
  it('keeps fuzzy result order while filtering hidden results', async () => {
    mocks.findFiles.mockResolvedValue({ data: ['src/z.ts', '.git/config', 'node_modules/a.ts', '.arche/config', 'opencode.json', 'src/a.ts'] })
    expect(await searchWorkspaceFiles('alice', 'sa')).toEqual({ ok: true, data: ['src/z.ts', 'src/a.ts'] })
  })
  it.each([
    ['text', 'utf-8', 'hello', 'hello', 'raw'],
    ['text', 'base64', Buffer.from('decoded').toString('base64'), 'decoded', 'raw'],
    ['patch', 'utf-8', '@@ patch', '@@ patch', 'patch'],
  ])('preserves %s/%s read content and raw/patch mapping', async (type, encoding, content, expected, mappedType) => {
    mocks.fileRead.mockResolvedValue({ data: { type, encoding, content } })
    expect(await readWorkspaceFile('alice', './src//a.ts')).toEqual({ ok: true, data: { path: 'src/a.ts', content: expected, type: mappedType } })
    expect(mocks.fileRead).toHaveBeenCalledExactlyOnceWith({ path: 'src/a.ts' })
  })
  it.each(['../secret', 'opencode.json', 'node_modules/a', ''])('rejects protected read path %s before contacting the runtime', async (path) => {
    expect(await readWorkspaceFile('alice', path)).toEqual({ ok: false, error: { code: 'runtime_error', detail: 'protected_path' } })
    expect(mocks.createInstanceClient).not.toHaveBeenCalled()
  })
  it('keeps empty lists and missing reads consistent with HEAD', async () => {
    mocks.fileList.mockResolvedValue({ data: null })
    mocks.findFiles.mockResolvedValue({ data: null })
    mocks.fileRead.mockResolvedValue({ data: null })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: true, data: [] })
    expect(await searchWorkspaceFiles('alice', 'missing')).toEqual({ ok: true, data: [] })
    expect(await readWorkspaceFile('alice', 'missing')).toEqual({ ok: false, error: { code: 'runtime_error', detail: 'file_not_found' } })
  })
  it.each([
    () => listWorkspaceFiles('alice'), () => readWorkspaceFile('alice', 'src/a.ts'), () => searchWorkspaceFiles('alice', 'sa'),
  ])('returns a typed unavailable result when the client is absent', async (operation) => {
    mocks.createInstanceClient.mockResolvedValue(null)
    expect(await operation()).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
  })
  it.each([
    ['list', () => listWorkspaceFiles('alice')], ['read', () => readWorkspaceFile('alice', 'src/a.ts')],
    ['search', () => searchWorkspaceFiles('alice', 'sa')],
  ] as const)('returns typed failures for %s transport errors', async (_name, operation) => {
    mocks.fileList.mockRejectedValue(new Error('network error'))
    mocks.fileRead.mockRejectedValue(new Error('network error'))
    mocks.findFiles.mockRejectedValue(new Error('network error'))
    expect(await operation()).toEqual({ ok: false, error: { code: 'runtime_error', detail: 'network error' } })
  })
})
