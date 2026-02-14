import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KickstartRepoWriteResult } from '@/kickstart/repositories'
import type { KickstartNormalizedApplyInput } from '@/kickstart/types'

const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockBuildKickstartArtifacts = vi.fn()
vi.mock('@/kickstart/build', () => ({
  buildKickstartArtifacts: (...args: unknown[]) => mockBuildKickstartArtifacts(...args),
}))

const mockAcquireKickstartApplyLock = vi.fn()
vi.mock('@/kickstart/lock', () => ({
  acquireKickstartApplyLock: (...args: unknown[]) => mockAcquireKickstartApplyLock(...args),
}))

const mockReplaceKickstartContentRepo = vi.fn()
const mockWriteKickstartConfigRepo = vi.fn()
vi.mock('@/kickstart/repositories', () => ({
  replaceKickstartContentRepo: (...args: unknown[]) => mockReplaceKickstartContentRepo(...args),
  writeKickstartConfigRepo: (...args: unknown[]) => mockWriteKickstartConfigRepo(...args),
}))

const mockGetKickstartStatus = vi.fn()
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mockGetKickstartStatus(...args),
}))

const mockParseKickstartApplyPayload = vi.fn()
vi.mock('@/kickstart/validation', () => ({
  parseKickstartApplyPayload: (...args: unknown[]) => mockParseKickstartApplyPayload(...args),
}))

const parsedInput: KickstartNormalizedApplyInput = {
  context: {
    companyName: 'Acme Labs',
    companyDescription: 'Analytics tools',
  },
  template: {
    id: 'blank',
    label: 'Blank',
    description: 'Minimal setup',
    kbSkeleton: [],
    agentsMdTemplate: '# AGENTS',
    recommendedAgentIds: ['assistant', 'knowledge-curator'],
    recommendedModels: {
      assistant: 'opencode/kimi-k2.5-free',
      'knowledge-curator': 'opencode/kimi-k2.5-free',
    },
  },
  agents: [
    { id: 'assistant' },
    { id: 'knowledge-curator' },
  ],
}

const builtArtifacts = {
  configContent: '{"$schema":"https://opencode.ai/config.json"}',
  agentsMdContent: '# AGENTS.md',
  kbDirectories: ['Outputs'],
  kbFiles: [{ path: 'Outputs/.gitkeep', content: '' }],
}

type RepoWriteError = Extract<KickstartRepoWriteResult, { ok: false }>['error']

function repoWriteFailure(error: RepoWriteError): KickstartRepoWriteResult {
  return {
    ok: false,
    error,
  }
}

async function callApply(payload: unknown = { any: 'payload' }) {
  const { applyKickstart } = await import('@/kickstart/apply')
  return applyKickstart(payload, 'admin-1')
}

describe('applyKickstart', () => {
  let releaseLockMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    releaseLockMock = vi.fn().mockResolvedValue(undefined)

    mockParseKickstartApplyPayload.mockReturnValue({
      ok: true,
      input: parsedInput,
    })
    mockAcquireKickstartApplyLock.mockResolvedValue({ ok: true, release: releaseLockMock })
    mockGetKickstartStatus.mockResolvedValue('needs_setup')
    mockBuildKickstartArtifacts.mockReturnValue({ ok: true, artifacts: builtArtifacts })
    mockWriteKickstartConfigRepo.mockResolvedValue({ ok: true })
    mockReplaceKickstartContentRepo.mockResolvedValue({ ok: true })
    mockAuditEvent.mockResolvedValue(undefined)
  })

  it.each([
    { error: 'conflict', expected: 'conflict' },
    { error: 'kb_unavailable', expected: 'kb_unavailable' },
    { error: 'write_failed', expected: 'apply_failed' },
  ])('maps lock acquisition error $error to $expected', async ({ error, expected }) => {
    mockAcquireKickstartApplyLock.mockResolvedValue({ ok: false, error })

    const result = await callApply()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(expected)
    }

    expect(mockWriteKickstartConfigRepo).not.toHaveBeenCalled()
    expect(mockReplaceKickstartContentRepo).not.toHaveBeenCalled()
  })

  it('always releases the lock in finally when apply throws', async () => {
    mockWriteKickstartConfigRepo.mockRejectedValue(new Error('boom'))

    const result = await callApply()
    expect(result).toEqual({
      ok: false,
      error: 'apply_failed',
      message: 'kickstart apply failed',
    })
    expect(releaseLockMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { repoError: 'kb_unavailable', expectedError: 'kb_unavailable' },
    { repoError: 'conflict', expectedError: 'conflict' },
    { repoError: 'write_failed', expectedError: 'apply_failed' },
  ])(
    'maps config write error $repoError to $expectedError',
    async ({ repoError, expectedError }) => {
      mockWriteKickstartConfigRepo.mockResolvedValue(repoWriteFailure(repoError))

      const result = await callApply()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(expectedError)
      }

      expect(mockAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kickstart.apply_failed',
          metadata: expect.objectContaining({
            stage: 'config_write',
            error: expectedError,
          }),
        })
      )
    }
  )

  it.each([
    { repoError: 'kb_unavailable', expectedError: 'kb_unavailable' },
    { repoError: 'conflict', expectedError: 'conflict' },
    { repoError: 'write_failed', expectedError: 'apply_failed' },
  ])('maps KB write error $repoError to $expectedError', async ({ repoError, expectedError }) => {
    mockReplaceKickstartContentRepo.mockResolvedValue(repoWriteFailure(repoError))

    const result = await callApply()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(expectedError)
    }

    expect(mockAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'kickstart.apply_failed',
        metadata: expect.objectContaining({
          stage: 'kb_write',
          error: expectedError,
        }),
      })
    )
  })
})
