import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: vi.fn(),
  writeCommonWorkspaceConfig: vi.fn(),
}))

import {
  readCommonWorkspaceConfig,
  writeCommonWorkspaceConfig,
} from '@/lib/common-workspace-config-store'
import {
  getMcpEnabledFromConfig,
  readMcpSettings,
  setMcpEnabledInConfig,
  writeMcpSettings,
} from '../settings'

const mockReadCommonWorkspaceConfig = vi.mocked(readCommonWorkspaceConfig)
const mockWriteCommonWorkspaceConfig = vi.mocked(writeCommonWorkspaceConfig)

describe('mcp settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults mcp to disabled when the config omits it', () => {
    expect(
      getMcpEnabledFromConfig({
        default_agent: 'assistant',
        agent: { assistant: {} },
      })
    ).toBe(false)
  })

  it('sets mcp enabled without disturbing the rest of the config', () => {
    expect(
      setMcpEnabledInConfig(
        {
          default_agent: 'assistant',
          agent: { assistant: {} },
        },
        true
      )
    ).toEqual({
      default_agent: 'assistant',
      agent: { assistant: {} },
      mcp: { enabled: true },
    })
  })

  it('reads mcp settings from common workspace config', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      hash: 'hash-1',
      path: '/kb-config#CommonWorkspaceConfig.json',
      content: JSON.stringify({
        default_agent: 'assistant',
        agent: { assistant: {} },
        mcp: { enabled: true },
      }),
    })

    await expect(readMcpSettings()).resolves.toEqual({
      ok: true,
      enabled: true,
      hash: 'hash-1',
    })
  })

  it('returns disabled when config cannot be read', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: false,
      error: 'kb_unavailable',
    })

    await expect(readMcpSettings()).resolves.toEqual({
      ok: false,
      enabled: false,
      error: 'kb_unavailable',
    })
  })

  it('writes mcp settings back to common workspace config', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      hash: 'hash-1',
      path: '/kb-config#CommonWorkspaceConfig.json',
      content: JSON.stringify({
        default_agent: 'assistant',
        agent: { assistant: {} },
      }),
    })
    mockWriteCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      hash: 'hash-2',
    })

    await expect(writeMcpSettings(true, 'hash-1')).resolves.toEqual({
      ok: true,
      enabled: true,
      hash: 'hash-2',
    })
    expect(mockWriteCommonWorkspaceConfig).toHaveBeenCalledWith(
      JSON.stringify(
        {
          default_agent: 'assistant',
          agent: { assistant: {} },
          mcp: { enabled: true },
        },
        null,
        2
      ) + '\n',
      'hash-1'
    )
  })
})
