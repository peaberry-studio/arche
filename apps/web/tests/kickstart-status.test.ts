import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadCommonWorkspaceConfig = vi.fn()
const mockReadConfigRepoFile = vi.fn()
vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: (...args: unknown[]) => mockReadCommonWorkspaceConfig(...args),
  readConfigRepoFile: (...args: unknown[]) => mockReadConfigRepoFile(...args),
}))

const mockParseCommonWorkspaceConfig = vi.fn()
const mockValidateCommonWorkspaceConfig = vi.fn()
vi.mock('@/lib/workspace-config', () => ({
  parseCommonWorkspaceConfig: (...args: unknown[]) => mockParseCommonWorkspaceConfig(...args),
  validateCommonWorkspaceConfig: (...args: unknown[]) => mockValidateCommonWorkspaceConfig(...args),
}))

const mockIsKickstartApplyLocked = vi.fn()
vi.mock('@/kickstart/lock', () => ({
  isKickstartApplyLocked: (...args: unknown[]) => mockIsKickstartApplyLocked(...args),
}))

const mockContentRepoHasTrackedFiles = vi.fn()
vi.mock('@/kickstart/repositories', () => ({
  contentRepoHasTrackedFiles: (...args: unknown[]) => mockContentRepoHasTrackedFiles(...args),
}))

describe('getKickstartStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockIsKickstartApplyLocked.mockResolvedValue(false)
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: true, content: '{"agent":{}}' })
    mockParseCommonWorkspaceConfig.mockReturnValue({ ok: true, config: { agent: {} } })
    mockValidateCommonWorkspaceConfig.mockReturnValue({ ok: true })
    mockReadConfigRepoFile.mockResolvedValue({ ok: true, content: '# AGENTS' })
    mockContentRepoHasTrackedFiles.mockResolvedValue(true)
  })

  it('returns setup_in_progress when setup lock is active', async () => {
    mockIsKickstartApplyLocked.mockResolvedValue(true)

    const { getKickstartStatus } = await import('@/kickstart/status')
    const status = await getKickstartStatus()

    expect(status).toBe('setup_in_progress')
    expect(mockReadCommonWorkspaceConfig).not.toHaveBeenCalled()
    expect(mockContentRepoHasTrackedFiles).not.toHaveBeenCalled()
  })

  it('returns ready when config is valid and KB has tracked files', async () => {
    const { getKickstartStatus } = await import('@/kickstart/status')
    const status = await getKickstartStatus()

    expect(status).toBe('ready')
  })

  it('returns needs_setup when KB has no tracked files', async () => {
    mockContentRepoHasTrackedFiles.mockResolvedValue(false)

    const { getKickstartStatus } = await import('@/kickstart/status')
    const status = await getKickstartStatus()

    expect(status).toBe('needs_setup')
  })

  it('bypasses lock check when ignoreLock is true', async () => {
    mockIsKickstartApplyLocked.mockResolvedValue(true)

    const { getKickstartStatus } = await import('@/kickstart/status')
    const status = await getKickstartStatus({ ignoreLock: true })

    expect(status).toBe('ready')
    expect(mockIsKickstartApplyLocked).not.toHaveBeenCalled()
  })
})
