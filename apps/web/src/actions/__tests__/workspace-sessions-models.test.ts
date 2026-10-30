import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockHarnessRuntime } from '@/actions/__tests__/helpers/harness-runtime'
import { listModelsAction } from '@/actions/workspace-sessions'
import type { HarnessModel } from '@/lib/harness/contract'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { getEnabledProviderIdsForUser } from '@/lib/providers/store'
import type { ProviderId } from '@/lib/providers/types'
import { getSession } from '@/lib/runtime/session'
import { userService } from '@/lib/services'

vi.mock('@/lib/runtime/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: vi.fn() }))
vi.mock('@/lib/providers/store', () => ({ getEnabledProviderIdsForUser: vi.fn() }))
vi.mock('@/lib/services', () => ({ userService: { findIdBySlug: vi.fn() } }))

const runtime = createMockHarnessRuntime()
const listModels = runtime.listModels
const model = (providerId: string, modelId: string, isDefault = false, cost?: HarnessModel['cost']): HarnessModel => ({
  providerId, modelId, providerName: providerId, modelName: modelId, isDefault, cost,
})
const models = [
  model('openai', 'gpt', true), model('huggingface', 'oss'), model('zai', 'glm'),
  model('opencode-go', 'go'), model('ollama', 'llama'), model('openrouter', 'auto'),
  model('opencode', 'free', false, { input: 0, output: 0 }),
  model('opencode', 'paid', true, { input: 1, output: 1 }),
  model('opencode', 'unknown-price'), model('fireworks', 'glm-5', true),
]
const owner = { user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' as const }, sessionId: 'auth-1' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSession).mockResolvedValue(owner)
  vi.mocked(getRuntimeForSlug).mockResolvedValue({ ok: true, data: runtime })
  listModels.mockResolvedValue({ ok: true, data: models })
  vi.mocked(getEnabledProviderIdsForUser).mockResolvedValue(new Set())
})

describe('model credential gating', () => {
  it('keeps only free native models without credentials and strips pricing metadata', async () => {
    expect(await listModelsAction('alice')).toEqual({ ok: true, models: [{
      providerId: 'opencode', providerName: 'opencode', modelId: 'free', modelName: 'free', isDefault: false,
    }] })
  })
  it.each(['openai', 'huggingface', 'zai', 'opencode-go', 'ollama', 'openrouter', 'fireworks'] satisfies ProviderId[])('includes %s only with active credentials', async (providerId) => {
    vi.mocked(getEnabledProviderIdsForUser).mockResolvedValue(new Set([providerId]))
    const result = await listModelsAction('alice')
    expect(result.models?.map((item) => item.providerId).sort()).toEqual([providerId, 'opencode'].sort())
  })
  it('keeps paid and unknown-price native models when credentials are configured', async () => {
    vi.mocked(getEnabledProviderIdsForUser).mockResolvedValue(new Set(['opencode']))
    const result = await listModelsAction('alice')
    expect(result.models?.map((item) => item.modelId)).toEqual(['paid', 'free', 'unknown-price'])
  })
  it('sorts defaults first then provider names', async () => {
    vi.mocked(getEnabledProviderIdsForUser).mockResolvedValue(new Set(['openai', 'zai', 'fireworks']))
    expect((await listModelsAction('alice')).models?.map((item) => item.providerId)).toEqual(['fireworks', 'openai', 'opencode', 'zai'])
  })
  it('uses the target workspace credentials for admin access', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'admin', role: 'ADMIN' } })
    vi.mocked(userService.findIdBySlug).mockResolvedValue({ id: 'target-user' })
    await listModelsAction('alice')
    expect(getEnabledProviderIdsForUser).toHaveBeenCalledWith('target-user')
  })
  it('rejects unauthorized and forbidden access before resolving a runtime', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await listModelsAction('alice')).toEqual({ ok: false, error: 'unauthorized' })
    vi.mocked(getSession).mockResolvedValue(owner)
    expect(await listModelsAction('bob')).toEqual({ ok: false, error: 'forbidden' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
  })
  it('rejects missing workspace owners', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'admin', role: 'ADMIN' } })
    vi.mocked(userService.findIdBySlug).mockResolvedValue(null)
    expect(await listModelsAction('alice')).toEqual({ ok: false, error: 'user_not_found' })
  })
  it('propagates registry and listing failures', async () => {
    vi.mocked(getRuntimeForSlug).mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await listModelsAction('alice')).toEqual({ ok: false, error: 'instance_unavailable' })
    vi.mocked(getRuntimeForSlug).mockResolvedValue({ ok: true, data: runtime })
    listModels.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    expect(await listModelsAction('alice')).toEqual({ ok: false, error: 'runtime_error' })
  })
})
