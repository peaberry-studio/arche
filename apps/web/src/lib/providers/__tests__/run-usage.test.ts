import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEffectiveCredentialForUser: vi.fn(),
  recordProviderRunUsage: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  providerUsageService: {
    recordProviderRunUsage: (...args: unknown[]) => mocks.recordProviderRunUsage(...args),
  },
}))

vi.mock('../store', () => ({
  getEffectiveCredentialForUser: (...args: unknown[]) => mocks.getEffectiveCredentialForUser(...args),
}))

import { recordProviderRunUsageBestEffort } from '../run-usage'

describe('recordProviderRunUsageBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recordProviderRunUsage.mockResolvedValue({ ok: true, recorded: true })
  })

  it('records opencode usage as default when no managed credential exists', async () => {
    mocks.getEffectiveCredentialForUser.mockResolvedValue(null)

    recordProviderRunUsageBestEffort({
      costUsd: 0,
      inputTokens: 100,
      messageRunId: 'run-1',
      modelId: 'zen-model',
      outputTokens: 50,
      providerId: 'opencode',
      source: 'web',
      userId: 'u1',
    }, '[test]')

    await vi.waitFor(() => {
      expect(mocks.recordProviderRunUsage).toHaveBeenCalledWith({
        costUsd: 0,
        credentialSource: 'default',
        inputTokens: 100,
        messageRunId: 'run-1',
        modelId: 'zen-model',
        outputTokens: 50,
        providerId: 'opencode',
        source: 'web',
        userId: 'u1',
      })
    })
  })
})
