import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgentSummaries: vi.fn(),
  parseCommonWorkspaceConfig: vi.fn(),
  readCommonWorkspaceConfig: vi.fn(),
  validateCommonWorkspaceConfig: vi.fn(),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: mocks.readCommonWorkspaceConfig,
}))

vi.mock('@/lib/workspace-config', () => ({
  getAgentSummaries: mocks.getAgentSummaries,
  parseCommonWorkspaceConfig: mocks.parseCommonWorkspaceConfig,
  validateCommonWorkspaceConfig: mocks.validateCommonWorkspaceConfig,
}))

import { listFlowAgentOptions } from '@/lib/flows/agents'

describe('listFlowAgentOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCommonWorkspaceConfig.mockResolvedValue({ ok: true, content: 'config' })
    mocks.parseCommonWorkspaceConfig.mockReturnValue({ ok: true, config: { agents: [] } })
    mocks.validateCommonWorkspaceConfig.mockReturnValue({ ok: true })
    mocks.getAgentSummaries.mockReturnValue([
      { displayName: 'Writer', id: 'writer', isPrimary: false },
      { displayName: 'Primary', id: 'primary', isPrimary: true },
      { displayName: 'Analyst', id: 'analyst', isPrimary: false },
    ])
  })

  it('returns primary agent first and sorts the rest by name', async () => {
    await expect(listFlowAgentOptions()).resolves.toEqual({
      ok: true,
      agents: [
        { displayName: 'Primary', id: 'primary', isPrimary: true },
        { displayName: 'Analyst', id: 'analyst', isPrimary: false },
        { displayName: 'Writer', id: 'writer', isPrimary: false },
      ],
    })
  })

  it('returns config store errors', async () => {
    mocks.readCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    await expect(listFlowAgentOptions()).resolves.toEqual({ ok: false, error: 'kb_unavailable' })
  })
})
