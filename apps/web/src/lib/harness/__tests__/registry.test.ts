import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { checkRuntimeHealth, getRuntimeForKind, getRuntimeForSlug, syncRuntimeProviderAccess } from '@/lib/harness/registry'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/adapters/opencode-v1/runtime', () => ({ createOpenCodeV1Runtime: factory }))
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ DEFAULT_HEALTH_TIMEOUT_MS: 5000, getInstanceBasicAuth: vi.fn(), getInstanceUrl: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/providers', () => ({ getProviderSyncHashForUser: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/workspace-prompt', () => ({ buildWorkspacePromptParts: vi.fn(), normalizeContextPaths: vi.fn(), normalizeMessageAttachments: vi.fn() }))

describe('runtime registry', () => {
  beforeEach(() => { vi.clearAllMocks(); factory.mockReturnValue(fakeRuntime()) })

  it('selects v1 for every slug in phase one', async () => {
    const result = await getRuntimeForSlug('alice')
    expect(result.ok && result.data.kind).toBe('opencode-v1')
    expect(factory).toHaveBeenCalledWith('alice')
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
