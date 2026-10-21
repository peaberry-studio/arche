import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindIdBySlug = vi.fn()
const mockFindRuntimeKindBySlug = vi.fn()
const mockIsDesktop = vi.fn()
const mockGetDesktopProviderGatewayConfig = vi.fn()
const mockBuildWorkspaceRuntimeArtifacts = vi.fn()
const mockHashWorkspaceRuntimeArtifacts = vi.fn()

vi.mock('@/lib/services', () => ({
  instanceService: {
    findRuntimeKindBySlug: (...args: unknown[]) => mockFindRuntimeKindBySlug(...args),
  },
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => mockIsDesktop(),
}))

vi.mock('@/lib/runtime/desktop/config', () => ({
  getDesktopArcheToolsCommand: () => ['desktop-node', 'arche-tools.js'],
  getDesktopProviderGatewayConfig: () => mockGetDesktopProviderGatewayConfig(),
}))

vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: (...args: unknown[]) => mockBuildWorkspaceRuntimeArtifacts(...args),
  hashWorkspaceRuntimeArtifacts: (...args: unknown[]) => mockHashWorkspaceRuntimeArtifacts(...args),
  getWebProviderGatewayConfig: () => ({ webConfig: true }),
}))

import { getRuntimeConfigHashForSlug } from '../runtime-config-hash'

describe('getRuntimeConfigHashForSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v2' })
  })

  it('returns error when user is not found', async () => {
    mockFindIdBySlug.mockResolvedValue(null)
    const result = await getRuntimeConfigHashForSlug('alice')
    expect(result).toEqual({ ok: false, error: 'user_not_found' })
  })

  it('returns hash for desktop mode', async () => {
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockIsDesktop.mockReturnValue(true)
    mockGetDesktopProviderGatewayConfig.mockReturnValue({ desktopConfig: true })
    mockBuildWorkspaceRuntimeArtifacts.mockResolvedValue({ artifacts: 'desktop' })
    mockHashWorkspaceRuntimeArtifacts.mockReturnValue('abc123hash')

    const result = await getRuntimeConfigHashForSlug('alice')
    expect(result).toEqual({ ok: true, hash: 'abc123hash' })
    expect(mockBuildWorkspaceRuntimeArtifacts).toHaveBeenCalledWith('alice', { desktopConfig: true }, { archeToolsCommand: ['desktop-node', 'arche-tools.js'], runtimeKind: 'opencode-v2' })
    expect(mockHashWorkspaceRuntimeArtifacts).toHaveBeenCalledWith({ artifacts: 'desktop' })
  })

  it('returns hash for web mode', async () => {
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockIsDesktop.mockReturnValue(false)
    mockBuildWorkspaceRuntimeArtifacts.mockResolvedValue({ artifacts: 'web' })
    mockHashWorkspaceRuntimeArtifacts.mockReturnValue('webhash456')

    const result = await getRuntimeConfigHashForSlug('alice')
    expect(result).toEqual({ ok: true, hash: 'webhash456' })
    expect(mockBuildWorkspaceRuntimeArtifacts).toHaveBeenCalledWith('alice', { webConfig: true }, { runtimeKind: 'opencode-v2' })
    expect(mockHashWorkspaceRuntimeArtifacts).toHaveBeenCalledWith({ artifacts: 'web' })
  })

  it('hashes the legacy runtime when the instance has no recorded kind', async () => {
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindRuntimeKindBySlug.mockResolvedValue(null)
    mockIsDesktop.mockReturnValue(false)
    mockBuildWorkspaceRuntimeArtifacts.mockResolvedValue({ artifacts: 'web' })

    await getRuntimeConfigHashForSlug('alice')
    expect(mockBuildWorkspaceRuntimeArtifacts).toHaveBeenCalledWith('alice', { webConfig: true }, { runtimeKind: null })
  })

  it('returns error when an exception is thrown', async () => {
    mockFindIdBySlug.mockRejectedValue(new Error('db error'))
    const result = await getRuntimeConfigHashForSlug('alice')
    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })
})
