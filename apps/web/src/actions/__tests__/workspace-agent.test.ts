import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.hoisted(() => vi.fn())
const mockCreateWorkspaceAgentClient = vi.hoisted(() => vi.fn())
const mockIsProtectedWorkspacePath = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/lib/runtime/session', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: mockCreateWorkspaceAgentClient,
}))

vi.mock('@/lib/workspace-paths', () => ({
  isProtectedWorkspacePath: mockIsProtectedWorkspacePath,
}))

import {
  readWorkspaceFileAction,
  writeWorkspaceFileAction,
  deleteWorkspaceFileAction,
  applyWorkspacePatchAction,
  getWorkspaceConflictAction,
  resolveWorkspaceConflictAction,
  discardWorkspaceFileChangesAction,
} from '../workspace-agent'

function mockAgent() {
  return { baseUrl: 'http://agent:8080', authHeader: 'Bearer tok' }
}

function mockFetchResponse(body: object, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('workspace-agent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mockCreateWorkspaceAgentClient.mockResolvedValue(mockAgent())
    mockIsProtectedWorkspacePath.mockReturnValue(false)
  })

  // -----------------------------------------------------------------------
  // Authorization (shared behavior)
  // -----------------------------------------------------------------------

  describe('authorization', () => {
    it('returns unauthorized when session is null', async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await readWorkspaceFileAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'unauthorized' })
    })

    it('returns forbidden for wrong slug non-admin', async () => {
      const result = await readWorkspaceFileAction('bob', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'forbidden' })
    })

    it('allows admin to access other slugs', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'u1', email: 'admin@b.com', slug: 'admin', role: 'ADMIN' },
        sessionId: 's1',
      })
      const spy = mockFetchResponse({ ok: true, content: 'data' })
      const result = await readWorkspaceFileAction('alice', 'file.txt')
      expect(result.ok).toBe(true)
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // readWorkspaceFileAction
  // -----------------------------------------------------------------------

  describe('readWorkspaceFileAction', () => {
    it('returns file content on success', async () => {
      const spy = mockFetchResponse({ ok: true, content: 'hello', hash: 'abc123' })
      const result = await readWorkspaceFileAction('alice', 'src/main.ts')
      expect(result).toEqual({
        ok: true,
        content: { path: 'src/main.ts', content: 'hello', type: 'raw' },
        hash: 'abc123',
      })
      spy.mockRestore()
    })

    it('decodes base64 content', async () => {
      const base64Content = Buffer.from('decoded text').toString('base64')
      const spy = mockFetchResponse({ ok: true, content: base64Content, encoding: 'base64', hash: 'h1' })
      const result = await readWorkspaceFileAction('alice', 'file.txt')
      expect(result.ok).toBe(true)
      expect(result.content?.content).toBe('decoded text')
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await readWorkspaceFileAction('alice', '.env')
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })

    it('returns error when agent is unavailable', async () => {
      mockCreateWorkspaceAgentClient.mockResolvedValue(null)
      const result = await readWorkspaceFileAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
    })

    it('handles agent HTTP errors', async () => {
      const spy = mockFetchResponse({ ok: false, error: 'not found' }, 404)
      const result = await readWorkspaceFileAction('alice', 'missing.txt')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('not found')
      spy.mockRestore()
    })

    it('handles network errors', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
      const result = await readWorkspaceFileAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' })
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // writeWorkspaceFileAction
  // -----------------------------------------------------------------------

  describe('writeWorkspaceFileAction', () => {
    it('writes file and returns hash', async () => {
      const spy = mockFetchResponse({ ok: true, hash: 'newhash' })
      const result = await writeWorkspaceFileAction('alice', 'file.txt', 'content')
      expect(result).toEqual({ ok: true, hash: 'newhash' })
      spy.mockRestore()
    })

    it('sends expectedHash and encoding when provided', async () => {
      const spy = mockFetchResponse({ ok: true, hash: 'h' })
      await writeWorkspaceFileAction('alice', 'file.txt', 'data', 'oldhash', { encoding: 'base64' })
      const call = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
      expect(call.expectedHash).toBe('oldhash')
      expect(call.encoding).toBe('base64')
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await writeWorkspaceFileAction('alice', '.env', 'secret')
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })

    it('handles agent HTTP errors', async () => {
      const spy = mockFetchResponse({ ok: false, error: 'disk full' }, 500)
      const result = await writeWorkspaceFileAction('alice', 'file.txt', 'data')
      expect(result.ok).toBe(false)
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // deleteWorkspaceFileAction
  // -----------------------------------------------------------------------

  describe('deleteWorkspaceFileAction', () => {
    it('deletes file on success', async () => {
      const spy = mockFetchResponse({ ok: true })
      const result = await deleteWorkspaceFileAction('alice', 'file.txt')
      expect(result).toEqual({ ok: true })
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await deleteWorkspaceFileAction('alice', '.env')
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })

    it('handles network errors', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
      const result = await deleteWorkspaceFileAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'timeout' })
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // applyWorkspacePatchAction
  // -----------------------------------------------------------------------

  describe('applyWorkspacePatchAction', () => {
    it('applies patch on success', async () => {
      const spy = mockFetchResponse({ ok: true })
      const result = await applyWorkspacePatchAction('alice', 'diff --git ...')
      expect(result).toEqual({ ok: true })
      spy.mockRestore()
    })

    it('handles agent errors', async () => {
      const spy = mockFetchResponse({ ok: false, error: 'patch_conflict' }, 409)
      const result = await applyWorkspacePatchAction('alice', 'bad patch')
      expect(result.ok).toBe(false)
      spy.mockRestore()
    })

    it('returns unauthorized when not logged in', async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await applyWorkspacePatchAction('alice', 'patch')
      expect(result).toEqual({ ok: false, error: 'unauthorized' })
    })
  })

  // -----------------------------------------------------------------------
  // getWorkspaceConflictAction
  // -----------------------------------------------------------------------

  describe('getWorkspaceConflictAction', () => {
    it('returns conflict details', async () => {
      const spy = mockFetchResponse({
        ok: true,
        path: 'file.txt',
        ours: 'our content',
        theirs: 'their content',
        base: 'base',
        working: 'working',
      })
      const result = await getWorkspaceConflictAction('alice', 'file.txt')
      expect(result).toEqual({
        ok: true,
        conflict: {
          path: 'file.txt',
          ours: 'our content',
          theirs: 'their content',
          base: 'base',
          working: 'working',
        },
      })
      spy.mockRestore()
    })

    it('returns conflict_not_found when no path in response', async () => {
      const spy = mockFetchResponse({ ok: true })
      const result = await getWorkspaceConflictAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'conflict_not_found' })
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await getWorkspaceConflictAction('alice', '.env')
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })

    it('defaults missing ours/theirs to empty strings', async () => {
      const spy = mockFetchResponse({ ok: true, path: 'file.txt' })
      const result = await getWorkspaceConflictAction('alice', 'file.txt')
      expect(result.ok).toBe(true)
      expect(result.conflict?.ours).toBe('')
      expect(result.conflict?.theirs).toBe('')
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // resolveWorkspaceConflictAction
  // -----------------------------------------------------------------------

  describe('resolveWorkspaceConflictAction', () => {
    it('resolves conflict on success', async () => {
      const spy = mockFetchResponse({ ok: true })
      const result = await resolveWorkspaceConflictAction('alice', {
        path: 'file.txt',
        strategy: 'ours',
      })
      expect(result).toEqual({ ok: true })
      spy.mockRestore()
    })

    it('sends manual content', async () => {
      const spy = mockFetchResponse({ ok: true })
      await resolveWorkspaceConflictAction('alice', {
        path: 'file.txt',
        strategy: 'manual',
        content: 'merged content',
      })
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.strategy).toBe('manual')
      expect(body.content).toBe('merged content')
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await resolveWorkspaceConflictAction('alice', {
        path: '.env',
        strategy: 'ours',
      })
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })
  })

  // -----------------------------------------------------------------------
  // discardWorkspaceFileChangesAction
  // -----------------------------------------------------------------------

  describe('discardWorkspaceFileChangesAction', () => {
    it('discards changes on success', async () => {
      const spy = mockFetchResponse({ ok: true })
      const result = await discardWorkspaceFileChangesAction('alice', 'file.txt')
      expect(result).toEqual({ ok: true })
      spy.mockRestore()
    })

    it('rejects protected paths', async () => {
      mockIsProtectedWorkspacePath.mockReturnValue(true)
      const result = await discardWorkspaceFileChangesAction('alice', '.env')
      expect(result).toEqual({ ok: false, error: 'protected_path' })
    })

    it('handles invalid JSON response', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not json', { status: 500 }),
      )
      const result = await discardWorkspaceFileChangesAction('alice', 'file.txt')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('workspace_agent_http_500')
      spy.mockRestore()
    })

    it('handles invalid JSON on 200', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not json', { status: 200 }),
      )
      const result = await discardWorkspaceFileChangesAction('alice', 'file.txt')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('workspace_agent_invalid_json')
      spy.mockRestore()
    })

    it('handles network error', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
      const result = await discardWorkspaceFileChangesAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'ECONNRESET' })
      spy.mockRestore()
    })

    it('handles non-Error exceptions', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error')
      const result = await discardWorkspaceFileChangesAction('alice', 'file.txt')
      expect(result).toEqual({ ok: false, error: 'workspace_agent_unreachable' })
      spy.mockRestore()
    })
  })
})
