import { beforeEach, describe, expect, it, vi } from 'vitest'

const readCommonWorkspaceConfigMock = vi.fn()

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: (...args: unknown[]) => readCommonWorkspaceConfigMock(...args),
}))

const parseCommonWorkspaceConfigMock = vi.fn()
const validateCommonWorkspaceConfigMock = vi.fn()
const getAgentSummariesMock = vi.fn()

vi.mock('@/lib/workspace-config', () => ({
  parseCommonWorkspaceConfig: (...args: unknown[]) => parseCommonWorkspaceConfigMock(...args),
  validateCommonWorkspaceConfig: (...args: unknown[]) => validateCommonWorkspaceConfigMock(...args),
  getAgentSummaries: (...args: unknown[]) => getAgentSummariesMock(...args),
}))

describe('listAutopilotAgentOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sorted agents with primary agents first', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: true,
      content: '{}',
      hash: 'hash-1',
      path: '/repo#CommonWorkspaceConfig.json',
    })

    const config = { default_agent: 'assistant', agent: {} }
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config })
    validateCommonWorkspaceConfigMock.mockReturnValue({ ok: true })
    getAgentSummariesMock.mockReturnValue([
      { id: 'researcher', displayName: 'Researcher', isPrimary: false },
      { id: 'assistant', displayName: 'Assistant', isPrimary: true },
      { id: 'analyst', displayName: 'Analyst', isPrimary: false },
    ])

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({
      ok: true,
      agents: [
        { id: 'assistant', displayName: 'Assistant', isPrimary: true },
        { id: 'analyst', displayName: 'Analyst', isPrimary: false },
        { id: 'researcher', displayName: 'Researcher', isPrimary: false },
      ],
    })
  })

  it('returns error when workspace config read fails', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({ ok: false, error: 'kb_unavailable' })
  })

  it('returns error when config parsing fails', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: true,
      content: 'invalid json',
      hash: 'hash-1',
      path: '/repo#CommonWorkspaceConfig.json',
    })

    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: false, error: 'invalid_json' })

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({ ok: false, error: 'invalid_json' })
  })

  it('returns error when config validation fails', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: true,
      content: '{}',
      hash: 'hash-1',
      path: '/repo#CommonWorkspaceConfig.json',
    })

    const config = { default_agent: 'assistant', agent: {} }
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config })
    validateCommonWorkspaceConfigMock.mockReturnValue({ ok: false, error: 'missing_default_agent' })

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({ ok: false, error: 'missing_default_agent' })
  })

  it('returns error with invalid_config fallback when validation error is null', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: true,
      content: '{}',
      hash: 'hash-1',
      path: '/repo#CommonWorkspaceConfig.json',
    })

    const config = { default_agent: 'assistant', agent: {} }
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config })
    validateCommonWorkspaceConfigMock.mockReturnValue({ ok: false, error: null })

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({ ok: false, error: 'invalid_config' })
  })

  it('returns empty agent list when no agents exist', async () => {
    readCommonWorkspaceConfigMock.mockResolvedValue({
      ok: true,
      content: '{}',
      hash: 'hash-1',
      path: '/repo#CommonWorkspaceConfig.json',
    })

    const config = { default_agent: 'assistant', agent: {} }
    parseCommonWorkspaceConfigMock.mockReturnValue({ ok: true, config })
    validateCommonWorkspaceConfigMock.mockReturnValue({ ok: true })
    getAgentSummariesMock.mockReturnValue([])

    const { listAutopilotAgentOptions } = await import('@/lib/autopilot/agents')
    const result = await listAutopilotAgentOptions()

    expect(result).toEqual({ ok: true, agents: [] })
  })
})
