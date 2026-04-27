import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockReadCommonWorkspaceConfig,
} = vi.hoisted(() => ({
  mockReadCommonWorkspaceConfig: vi.fn(),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: mockReadCommonWorkspaceConfig,
}))

import { loadSlackAgentOptions } from '@/lib/slack/agents'

const VALID_CONFIG = JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  default_agent: 'main',
  agent: {
    main: {
      mode: 'primary',
      tools: {},
      permission: {},
    },
    helper: {
      tools: {},
      permission: {},
    },
  },
})

describe('loadSlackAgentOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns agents sorted with primary first', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: true, content: VALID_CONFIG })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.agents.length).toBe(2)
    expect(result.agents[0].id).toBe('main')
    expect(result.agents[0].isPrimary).toBe(true)
    expect(result.primaryAgentId).toBe('main')
  })

  it('returns default config when config not found', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'not_found' })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.agents.length).toBeGreaterThan(0)
  })

  it('returns error when kb is unavailable', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('kb_unavailable')
  })

  it('returns error when read fails', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'read_failed' })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('read_failed')
  })

  it('returns invalid_config when config content is invalid JSON', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: true, content: 'not json' })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_config')
  })

  it('returns invalid_config when config validation fails', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ bad: 'schema' }),
    })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_config')
  })

  it('sorts non-primary agents alphabetically', async () => {
    const config = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'main',
      agent: {
        zebra: { tools: {}, permission: {} },
        main: { mode: 'primary', tools: {}, permission: {} },
        alpha: { tools: {}, permission: {} },
      },
    })
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: true, content: config })

    const result = await loadSlackAgentOptions()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.agents[0].id).toBe('main')
    expect(result.agents[1].id).toBe('alpha')
    expect(result.agents[2].id).toBe('zebra')
  })
})
