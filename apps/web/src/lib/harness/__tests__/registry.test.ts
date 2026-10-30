import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { checkRuntimeHealth, getLegacySessionReader, getRuntimeForSlug, listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles, syncRuntimeProviderAccess } from '@/lib/harness/registry'

const readerFactory = vi.hoisted(() => vi.fn())
const v2Factory = vi.hoisted(() => vi.fn())
const findRuntimeKindBySlug = vi.hoisted(() => vi.fn())
const v2Files = vi.hoisted(() => ({ listWorkspaceFiles: vi.fn(), readWorkspaceFile: vi.fn(), searchWorkspaceFiles: vi.fn() }))
vi.mock('@/lib/services', () => ({ instanceService: { findRuntimeKindBySlug } }))
vi.mock('@/lib/harness/adapters/opencode-v1/reader', () => ({ createOpenCodeV1Reader: readerFactory }))
vi.mock('@/lib/harness/adapters/opencode-v2/runtime', () => ({ createOpenCodeV2Runtime: v2Factory }))
vi.mock('@/lib/harness/adapters/opencode-v2/workspace-files', () => v2Files)
vi.mock('@/lib/harness/runtime-connection', () => ({ DEFAULT_HEALTH_TIMEOUT_MS: 5000, getInstanceBasicAuth: vi.fn(), getInstanceUrl: vi.fn() }))
vi.mock('@/lib/harness/workspace-prompt', () => ({ buildWorkspacePromptParts: vi.fn(), normalizeContextPaths: vi.fn(), normalizeMessageAttachments: vi.fn() }))

describe('runtime registry', () => {
  let runtime: Omit<ReturnType<typeof fakeRuntime>, 'kind'> & { kind: string }

  beforeEach(() => {
    vi.clearAllMocks()
    runtime = { ...fakeRuntime(), kind: 'opencode-v2' }
    v2Factory.mockReturnValue(runtime)
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v2' })
  })

  it.each([
    ['a workspace recorded on OpenCode 2', { runtimeKind: 'opencode-v2' }],
    ['a workspace that never started', null],
  ])('serves %s with the v2 runtime', async (_label, recorded) => {
    findRuntimeKindBySlug.mockResolvedValue(recorded)
    const result = await getRuntimeForSlug('alice')
    expect(result.ok && result.data.kind).toBe('opencode-v2')
    expect(v2Factory).toHaveBeenCalledWith('alice')
  })

  it.each([
    [null, 'opencode-v1'],
    ['opencode-v1', 'opencode-v1'],
    ['codex', 'codex'],
  ])('refuses a workspace recorded as %s until it restarts and migrates', async (runtimeKind, detail) => {
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind })
    expect(await getRuntimeForSlug('alice')).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail } })
    expect(v2Factory).not.toHaveBeenCalled()
  })

  it('reports the lookup failure instead of guessing a runtime', async () => {
    findRuntimeKindBySlug.mockRejectedValue(new Error('database unavailable'))
    expect(await getRuntimeForSlug('alice')).toEqual({ ok: false, error: { code: 'instance_unavailable', detail: 'runtime_kind_lookup_failed' } })
    expect(v2Factory).not.toHaveBeenCalled()
  })

  it('binds the legacy history reader to explicit archive credentials without a kind lookup', () => {
    const connection = { baseUrl: 'http://archive:4096', authHeader: 'Basic fixture', signal: new AbortController().signal }
    readerFactory.mockReturnValue({ slug: 'alice' })
    expect(getLegacySessionReader('alice', connection)).toEqual({ slug: 'alice' })
    expect(readerFactory).toHaveBeenCalledWith('alice', connection)
    expect(findRuntimeKindBySlug).not.toHaveBeenCalled()
  })

  it('serves the file bridge from v2 and refuses it for a legacy workspace', async () => {
    v2Files.listWorkspaceFiles.mockResolvedValue({ ok: true, data: [] })
    v2Files.readWorkspaceFile.mockResolvedValue({ ok: true, data: { path: 'file.md', content: 'v2', type: 'raw' } })
    v2Files.searchWorkspaceFiles.mockResolvedValue({ ok: true, data: ['file.md'] })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: true, data: [] })
    expect(await readWorkspaceFile('alice', 'file.md')).toEqual({ ok: true, data: { path: 'file.md', content: 'v2', type: 'raw' } })
    expect(await searchWorkspaceFiles('alice', 'file')).toEqual({ ok: true, data: ['file.md'] })
    expect(v2Files.listWorkspaceFiles).toHaveBeenCalledWith('alice', '')

    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v1' })
    expect(await listWorkspaceFiles('alice')).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: 'opencode-v1' } })
    expect(v2Files.listWorkspaceFiles).toHaveBeenCalledTimes(1)
  })

  it('does not probe or sync a workspace that has not migrated', async () => {
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v1' })
    const failure = { ok: false, error: { code: 'runtime_unsupported', detail: 'opencode-v1' } }
    expect(await checkRuntimeHealth('alice')).toEqual(failure)
    expect(await syncRuntimeProviderAccess('alice', { userId: 'u1' })).toEqual(failure)
    expect(runtime.health).not.toHaveBeenCalled()
    expect(runtime.syncProviderAccess).not.toHaveBeenCalled()
  })

  it('delegates pre-start health credentials and cancellation', async () => {
    const options = { password: 'pw', baseUrl: 'http://container:4096', timeoutMs: 100, signal: new AbortController().signal }
    expect(await checkRuntimeHealth('alice', options)).toEqual({ ok: true, data: {} })
    expect(runtime.health).toHaveBeenCalledWith(options)
  })

  it('delegates explicit provider access synchronization', async () => {
    const input = { userId: 'u1', connection: { baseUrl: 'http://runtime', authHeader: 'Basic auth' }, disposeInstance: false }
    expect(await syncRuntimeProviderAccess('alice', input)).toEqual({ ok: true, data: undefined })
    expect(runtime.syncProviderAccess).toHaveBeenCalledWith(input)
  })
})
