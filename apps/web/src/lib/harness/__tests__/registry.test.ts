import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { checkRuntimeHealth, getRuntimeForKind, getRuntimeForSlug, listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles, syncRuntimeProviderAccess } from '@/lib/harness/registry'

const factory = vi.hoisted(() => vi.fn())
const findRuntimeKindBySlug = vi.hoisted(() => vi.fn())
const files = vi.hoisted(() => ({ listWorkspaceFiles: vi.fn(), readWorkspaceFile: vi.fn(), searchWorkspaceFiles: vi.fn() }))
vi.mock('@/lib/services', () => ({ instanceService: { findRuntimeKindBySlug } }))
vi.mock('@/lib/harness/adapters/opencode-v1/runtime', () => ({ createOpenCodeV1Runtime: factory }))
vi.mock('@/lib/harness/adapters/opencode-v1/workspace-files', () => files)
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ DEFAULT_HEALTH_TIMEOUT_MS: 5000, getInstanceBasicAuth: vi.fn(), getInstanceUrl: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/providers', () => ({ getProviderSyncHashForUser: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/workspace-prompt', () => ({ buildWorkspacePromptParts: vi.fn(), normalizeContextPaths: vi.fn(), normalizeMessageAttachments: vi.fn() }))

describe('runtime registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    factory.mockReturnValue(fakeRuntime())
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: null })
  })

  it('selects v1 for a legacy instance', async () => {
    const result = await getRuntimeForSlug('alice')
    expect(result.ok && result.data.kind).toBe('opencode-v1')
    expect(factory).toHaveBeenCalledWith('alice')
    expect(findRuntimeKindBySlug).toHaveBeenCalledWith('alice')
  })

  it('uses recorded kinds, not the deployment default, in the same process', async () => {
    vi.stubEnv('ARCHE_DEFAULT_RUNTIME_KIND', 'opencode-v2')
    findRuntimeKindBySlug.mockImplementation(async (slug: string) => ({ runtimeKind: slug === 'alice' ? 'opencode-v1' : 'opencode-v2' }))
    try {
      expect((await getRuntimeForSlug('alice')).ok).toBe(true)
      expect(await getRuntimeForSlug('bob')).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: 'opencode-v2' } })
      expect(factory).toHaveBeenCalledTimes(1)
      expect(factory).toHaveBeenCalledWith('alice')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not fall back to v1 when the kind lookup fails', async () => {
    findRuntimeKindBySlug.mockRejectedValue(new Error('database unavailable'))
    expect(await getRuntimeForSlug('alice')).toEqual({ ok: false, error: { code: 'instance_unavailable', detail: 'runtime_kind_lookup_failed' } })
    expect(factory).not.toHaveBeenCalled()
  })

  it('does not contact v1 file endpoints for an unsupported recorded kind', async () => {
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v2' })
    const failure = { ok: false, error: { code: 'runtime_unsupported', detail: 'opencode-v2' } }
    expect(await listWorkspaceFiles('alice')).toEqual(failure)
    expect(await readWorkspaceFile('alice', 'file.md')).toEqual(failure)
    expect(await searchWorkspaceFiles('alice', 'file')).toEqual(failure)
    expect(files.listWorkspaceFiles).not.toHaveBeenCalled()
    expect(files.readWorkspaceFile).not.toHaveBeenCalled()
    expect(files.searchWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('does not probe or sync an unsupported recorded runtime', async () => {
    findRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'unknown' })
    const failure = { ok: false, error: { code: 'runtime_unsupported', detail: 'unknown' } }
    expect(await checkRuntimeHealth('alice')).toEqual(failure)
    expect(await syncRuntimeProviderAccess('alice', { userId: 'u1' })).toEqual(failure)
    expect(factory).not.toHaveBeenCalled()
  })

  it.each([null, 'opencode-v1'])('maps recorded kind %s to v1', (kind) => {
    expect(getRuntimeForKind('alice', kind).ok).toBe(true)
    expect(factory).toHaveBeenCalledWith('alice')
  })

  it.each(['opencode-v2', 'unknown'])('rejects unsupported kind %s without contacting an adapter', (kind) => {
    expect(getRuntimeForKind('alice', kind)).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: kind } })
    expect(factory).not.toHaveBeenCalled()
  })

  it('delegates pre-start health credentials and cancellation', async () => {
    const runtime = fakeRuntime()
    factory.mockReturnValue(runtime)
    const options = { password: 'password', baseUrl: 'http://container:4096', timeoutMs: 100, signal: new AbortController().signal }
    expect(await checkRuntimeHealth('alice', options)).toEqual({ ok: true, data: {} })
    expect(runtime.health).toHaveBeenCalledWith(options)
  })

  it('delegates explicit provider access synchronization', async () => {
    const runtime = fakeRuntime()
    factory.mockReturnValue(runtime)
    const input = { userId: 'u1', connection: { baseUrl: 'http://runtime', authHeader: 'Basic auth' }, disposeInstance: false }
    expect(await syncRuntimeProviderAccess('alice', input)).toEqual({ ok: true, data: undefined })
    expect(runtime.syncProviderAccess).toHaveBeenCalledWith(input)
  })
})
