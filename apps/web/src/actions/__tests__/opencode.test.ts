import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks – declared before any import that touches them
// ---------------------------------------------------------------------------

vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  createInstanceClient: vi.fn(),
  getInstanceUrl: vi.fn(() => 'http://opencode-alice:4096'),
}))

vi.mock('@/lib/opencode/transform', () => ({
  extractTextContent: vi.fn((parts: unknown[]) => {
    const first = (parts as { type: string; text?: string }[]).find((p) => p.type === 'text')
    return first ? (first as { text: string }).text : ''
  }),
  transformParts: vi.fn((parts: unknown[]) => parts),
}))

vi.mock('@/lib/workspace-message-state', () => ({
  deriveWorkspaceMessageRuntimeState: vi.fn(() => ({
    pending: false,
    statusInfo: undefined,
  })),
}))

vi.mock('@/lib/providers/catalog', () => ({
  getCanonicalProviderId: vi.fn((id: string) => id),
  getProviderLabel: vi.fn((id: string) => id),
  normalizeProviderId: vi.fn((id: string) => id),
  resolveRuntimeProviderId: vi.fn((id: string) => id),
}))

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  autopilotService: {
    findSessionMetadataByUserId: vi.fn().mockResolvedValue([]),
    markRunResultSeenByIdAndUserId: vi.fn(),
  },
  instanceService: {
    findCredentialsBySlug: vi.fn(),
  },
  slackService: {
    deleteSessionBindingsByOpenCodeSessionId: vi.fn(),
  },
  userService: {
    findIdBySlug: vi.fn(),
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: vi.fn(() => 'decrypted-password'),
}))

vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getSession } from '@/lib/runtime/session'
import { createInstanceClient } from '@/lib/opencode/client'
import { autopilotService, instanceService, slackService, userService } from '@/lib/services'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

import {
  checkConnectionAction,
  listFilesAction,
  readFileAction,
  searchFilesAction,
  loadFileTreeAction,
  createSessionAction,
  deleteSessionAction,
  updateSessionAction,
  listMessagesAction,
  sendMessageAction,
  abortSessionAction,
  getWorkspaceDiffsAction,
  getSessionDiffsAction,
  listAgentsAction,
  markAutopilotRunSeenAction,
} from '../opencode'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockGetSession = vi.mocked(getSession)
const mockCreateInstanceClient = vi.mocked(createInstanceClient)
const mockInstanceService = vi.mocked(instanceService)
const mockSlackService = vi.mocked(slackService)
const mockUserService = vi.mocked(userService)
const mockAutopilotService = vi.mocked(autopilotService)
const mockCreateWorkspaceAgentClient = vi.mocked(createWorkspaceAgentClient)

const fakeSession = {
  user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' as const },
  sessionId: 'sess-1',
}

const adminSession = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' as const },
  sessionId: 'sess-2',
}

// Stub client methods
const mockHealthFn = vi.fn()
const mockFileList = vi.fn()
const mockFileRead = vi.fn()
const mockFindFiles = vi.fn()
const mockSessionCreate = vi.fn()
const mockSessionDelete = vi.fn()
const mockSessionUpdate = vi.fn()
const mockSessionMessages = vi.fn()
const mockSessionAbort = vi.fn()
const mockSessionStatus = vi.fn()
const mockSessionDiff = vi.fn()
const mockAppAgents = vi.fn()

function makeClient() {
  return {
    global: { health: mockHealthFn },
    file: { list: mockFileList, read: mockFileRead },
    find: { files: mockFindFiles },
    session: {
      create: mockSessionCreate,
      delete: mockSessionDelete,
      update: mockSessionUpdate,
      messages: mockSessionMessages,
      abort: mockSessionAbort,
      status: mockSessionStatus,
      diff: mockSessionDiff,
    },
    config: { providers: vi.fn() },
    app: { agents: mockAppAgents },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(fakeSession)
  mockCreateInstanceClient.mockResolvedValue(makeClient())
  mockSessionStatus.mockResolvedValue({ data: {} })
  mockSlackService.deleteSessionBindingsByOpenCodeSessionId.mockResolvedValue({ dm: 0, thread: 0 })
  // Mock global fetch
  vi.stubGlobal('fetch', vi.fn())
})

// ============================================================================
// Connection & Health
// ============================================================================

describe('checkConnectionAction', () => {
  it('returns error when no session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'error', error: 'unauthorized' })
  })

  it('returns error when user is forbidden', async () => {
    const result = await checkConnectionAction('bob')
    expect(result).toEqual({ status: 'error', error: 'forbidden' })
  })

  it('returns error when client is null', async () => {
    mockCreateInstanceClient.mockResolvedValue(null)
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'error', error: 'instance_unavailable' })
  })

  it('returns connected when healthy', async () => {
    mockHealthFn.mockResolvedValue({ data: { healthy: true, version: '1.0.0' } })
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'connected', version: '1.0.0' })
  })

  it('returns error when unhealthy', async () => {
    mockHealthFn.mockResolvedValue({ data: { healthy: false } })
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'error', error: 'unhealthy' })
  })

  it('returns error when health check throws', async () => {
    mockHealthFn.mockRejectedValue(new Error('network error'))
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'error', error: 'network error' })
  })

  it('returns unknown when health check throws non-Error', async () => {
    mockHealthFn.mockRejectedValue('boom')
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'error', error: 'unknown' })
  })

  it('allows admin to check connection for another user', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockHealthFn.mockResolvedValue({ data: { healthy: true, version: '2.0' } })
    const result = await checkConnectionAction('alice')
    expect(result).toEqual({ status: 'connected', version: '2.0' })
  })
})

// ============================================================================
// Files
// ============================================================================

describe('listFilesAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await listFilesAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns files, filtering out ignored and hidden paths', async () => {
    mockFileList.mockResolvedValue({
      data: [
        { path: 'src/index.ts', name: 'index.ts', type: 'file', ignored: false },
        { path: '.arche/config', name: 'config', type: 'file', ignored: false },
        { path: 'ignored.ts', name: 'ignored.ts', type: 'file', ignored: true },
        { path: 'opencode.json', name: 'opencode.json', type: 'file', ignored: false },
      ],
    })

    const result = await listFilesAction('alice')

    expect(result.ok).toBe(true)
    expect(result.files).toHaveLength(1)
    expect(result.files![0]).toEqual({
      id: 'src/index.ts',
      name: 'index.ts',
      path: 'src/index.ts',
      type: 'file',
    })
  })

  it('uses empty string as default path', async () => {
    mockFileList.mockResolvedValue({ data: [] })
    await listFilesAction('alice')
    expect(mockFileList).toHaveBeenCalledWith({ path: '' })
  })

  it('passes custom path', async () => {
    mockFileList.mockResolvedValue({ data: [] })
    await listFilesAction('alice', 'src')
    expect(mockFileList).toHaveBeenCalledWith({ path: 'src' })
  })

  it('handles null data', async () => {
    mockFileList.mockResolvedValue({ data: null })
    const result = await listFilesAction('alice')
    expect(result).toEqual({ ok: true, files: [] })
  })

  it('returns error on exception', async () => {
    mockFileList.mockRejectedValue(new Error('fail'))
    const result = await listFilesAction('alice')
    expect(result).toEqual({ ok: false, error: 'fail' })
  })
})

describe('readFileAction', () => {
  it('returns error for protected paths', async () => {
    const result = await readFileAction('alice', 'opencode.json')
    expect(result).toEqual({ ok: false, error: 'protected_path' })
  })

  it('returns error for node_modules paths', async () => {
    const result = await readFileAction('alice', 'node_modules/lodash/index.js')
    expect(result).toEqual({ ok: false, error: 'protected_path' })
  })

  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await readFileAction('alice', 'src/index.ts')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns file content', async () => {
    mockFileRead.mockResolvedValue({
      data: { content: 'hello world', type: 'text', encoding: 'utf-8' },
    })

    const result = await readFileAction('alice', 'src/index.ts')

    expect(result.ok).toBe(true)
    expect(result.content).toEqual({
      path: 'src/index.ts',
      content: 'hello world',
      type: 'raw',
    })
  })

  it('decodes base64 content', async () => {
    const encoded = Buffer.from('decoded content').toString('base64')
    mockFileRead.mockResolvedValue({
      data: { content: encoded, type: 'text', encoding: 'base64' },
    })

    const result = await readFileAction('alice', 'src/index.ts')

    expect(result.ok).toBe(true)
    expect(result.content!.content).toBe('decoded content')
  })

  it('returns error when file not found', async () => {
    mockFileRead.mockResolvedValue({ data: null })
    const result = await readFileAction('alice', 'src/missing.ts')
    expect(result).toEqual({ ok: false, error: 'file_not_found' })
  })

  it('returns patch type for non-text files', async () => {
    mockFileRead.mockResolvedValue({
      data: { content: 'data', type: 'binary', encoding: 'utf-8' },
    })

    const result = await readFileAction('alice', 'src/image.png')

    expect(result.content!.type).toBe('patch')
  })

  it('handles exceptions', async () => {
    mockFileRead.mockRejectedValue(new Error('read error'))
    const result = await readFileAction('alice', 'src/index.ts')
    expect(result).toEqual({ ok: false, error: 'read error' })
  })
})

describe('searchFilesAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await searchFilesAction('alice', 'test')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns matching files', async () => {
    mockFindFiles.mockResolvedValue({
      data: ['src/index.ts', 'src/utils.ts'],
    })

    const result = await searchFilesAction('alice', 'index')

    expect(result.ok).toBe(true)
    expect(result.files).toEqual(['src/index.ts', 'src/utils.ts'])
  })

  it('filters out hidden paths', async () => {
    mockFindFiles.mockResolvedValue({
      data: ['src/index.ts', '.arche/config.json', 'opencode.json'],
    })

    const result = await searchFilesAction('alice', 'json')

    expect(result.files).toEqual(['src/index.ts'])
  })

  it('handles null data', async () => {
    mockFindFiles.mockResolvedValue({ data: null })
    const result = await searchFilesAction('alice', 'test')
    expect(result).toEqual({ ok: true, files: [] })
  })

  it('handles exceptions', async () => {
    mockFindFiles.mockRejectedValue(new Error('search fail'))
    const result = await searchFilesAction('alice', 'test')
    expect(result).toEqual({ ok: false, error: 'search fail' })
  })
})

describe('loadFileTreeAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await loadFileTreeAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns a flat tree', async () => {
    mockFileList.mockResolvedValue({
      data: [
        { path: 'src', name: 'src', type: 'directory', ignored: false },
        { path: 'README.md', name: 'README.md', type: 'file', ignored: false },
      ],
    })
    // Subsequent call for the src directory returns empty
    mockFileList.mockResolvedValueOnce({
      data: [
        { path: 'src', name: 'src', type: 'directory', ignored: false },
        { path: 'README.md', name: 'README.md', type: 'file', ignored: false },
      ],
    }).mockResolvedValueOnce({ data: [] })

    const result = await loadFileTreeAction('alice')

    expect(result.ok).toBe(true)
    expect(result.tree).toBeDefined()
  })

  it('respects maxDepth', async () => {
    // First level
    mockFileList.mockResolvedValueOnce({
      data: [
        { path: 'a', name: 'a', type: 'directory', ignored: false },
      ],
    })
    // Second level (depth 1)
    mockFileList.mockResolvedValueOnce({
      data: [
        { path: 'a/b', name: 'b', type: 'directory', ignored: false },
      ],
    })
    // Would be depth 2, but maxDepth=1 stops it
    // This shouldn't be called if maxDepth is respected
    mockFileList.mockResolvedValueOnce({ data: [] })

    const result = await loadFileTreeAction('alice', 1)

    expect(result.ok).toBe(true)
    // depth=0 -> loads root (calls list), depth=1 -> loads a/b (calls list), depth=2 > maxDepth -> returns []
    expect(mockFileList).toHaveBeenCalledTimes(2)
  })

  it('handles exceptions', async () => {
    mockFileList.mockReset()
    mockFileList.mockRejectedValue(new Error('tree fail'))
    const result = await loadFileTreeAction('alice')
    expect(result).toEqual({ ok: false, error: 'tree fail' })
  })

  it('filters hidden and ignored files in tree', async () => {
    mockFileList.mockResolvedValueOnce({
      data: [
        { path: 'src', name: 'src', type: 'directory', ignored: false },
        { path: '.arche', name: '.arche', type: 'directory', ignored: false },
        { path: 'ignored.ts', name: 'ignored.ts', type: 'file', ignored: true },
      ],
    }).mockResolvedValueOnce({ data: [] })

    const result = await loadFileTreeAction('alice')
    expect(result.ok).toBe(true)
    expect(result.tree!.length).toBe(1)
    expect(result.tree![0].name).toBe('src')
  })
})

// ============================================================================
// Sessions
// ============================================================================

describe('createSessionAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await createSessionAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('creates a session with a title', async () => {
    mockSessionCreate.mockResolvedValue({
      data: {
        id: 'session-1',
        title: 'My Session',
        time: { updated: Date.now() },
        parentID: undefined,
      },
    })

    const result = await createSessionAction('alice', 'My Session')

    expect(result.ok).toBe(true)
    expect(result.session!.id).toBe('session-1')
    expect(result.session!.title).toBe('My Session')
    expect(result.session!.status).toBe('active')
  })

  it('defaults to Untitled when no title', async () => {
    mockSessionCreate.mockResolvedValue({
      data: {
        id: 'session-1',
        title: '',
        time: { updated: Date.now() },
      },
    })

    const result = await createSessionAction('alice')

    expect(result.session!.title).toBe('Untitled')
  })

  it('returns error when creation fails', async () => {
    mockSessionCreate.mockResolvedValue({ data: null })
    const result = await createSessionAction('alice')
    expect(result).toEqual({ ok: false, error: 'create_failed' })
  })

  it('handles exceptions', async () => {
    mockSessionCreate.mockRejectedValue(new Error('create err'))
    const result = await createSessionAction('alice')
    expect(result).toEqual({ ok: false, error: 'create err' })
  })
})

describe('deleteSessionAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await deleteSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('deletes session successfully', async () => {
    mockSessionDelete.mockResolvedValue(undefined)
    const result = await deleteSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: true })
    expect(mockSessionDelete).toHaveBeenCalledWith({ sessionID: 'sess-1' })
    expect(mockSlackService.deleteSessionBindingsByOpenCodeSessionId).toHaveBeenCalledWith('sess-1')
  })

  it('removes Slack bindings for the deleted session', async () => {
    mockSessionDelete.mockResolvedValue(undefined)
    mockSlackService.deleteSessionBindingsByOpenCodeSessionId.mockResolvedValue({ dm: 1, thread: 1 })

    const result = await deleteSessionAction('alice', 'sess-1')

    expect(result).toEqual({ ok: true })
    expect(mockSlackService.deleteSessionBindingsByOpenCodeSessionId).toHaveBeenCalledWith('sess-1')
  })

  it('handles exceptions', async () => {
    mockSessionDelete.mockRejectedValue(new Error('del err'))
    const result = await deleteSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'del err' })
  })
})

describe('updateSessionAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await updateSessionAction('alice', 'sess-1', 'New Title')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('updates session title', async () => {
    mockSessionUpdate.mockResolvedValue({
      data: {
        id: 'sess-1',
        title: 'New Title',
        time: { updated: Date.now() },
        parentID: undefined,
      },
    })

    const result = await updateSessionAction('alice', 'sess-1', 'New Title')

    expect(result.ok).toBe(true)
    expect(result.session!.title).toBe('New Title')
    expect(result.session!.status).toBe('idle')
  })

  it('returns error when update fails', async () => {
    mockSessionUpdate.mockResolvedValue({ data: null })
    const result = await updateSessionAction('alice', 'sess-1', 'New Title')
    expect(result).toEqual({ ok: false, error: 'update_failed' })
  })

  it('handles exceptions', async () => {
    mockSessionUpdate.mockRejectedValue(new Error('update err'))
    const result = await updateSessionAction('alice', 'sess-1', 'New Title')
    expect(result).toEqual({ ok: false, error: 'update err' })
  })
})

describe('markAutopilotRunSeenAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await markAutopilotRunSeenAction('alice', 'run-1')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns error when forbidden', async () => {
    const result = await markAutopilotRunSeenAction('bob', 'run-1')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('marks run as seen successfully', async () => {
    mockAutopilotService.markRunResultSeenByIdAndUserId.mockResolvedValue(true as never)
    const result = await markAutopilotRunSeenAction('alice', 'run-1')
    expect(result).toEqual({ ok: true })
  })

  it('returns not_found when mark fails', async () => {
    mockAutopilotService.markRunResultSeenByIdAndUserId.mockResolvedValue(false as never)
    const result = await markAutopilotRunSeenAction('alice', 'run-1')
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('resolves target user for admin accessing another slug', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockUserService.findIdBySlug.mockResolvedValue({ id: 'target-user' } as never)
    mockAutopilotService.markRunResultSeenByIdAndUserId.mockResolvedValue(true as never)

    const result = await markAutopilotRunSeenAction('alice', 'run-1')
    expect(result).toEqual({ ok: true })
    expect(mockAutopilotService.markRunResultSeenByIdAndUserId).toHaveBeenCalledWith(
      'run-1',
      'target-user',
      expect.any(Date),
    )
  })

  it('returns user_not_found when target user does not exist', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockUserService.findIdBySlug.mockResolvedValue(null as never)

    const result = await markAutopilotRunSeenAction('alice', 'run-1')
    expect(result).toEqual({ ok: false, error: 'user_not_found' })
  })
})

// ============================================================================
// Messages
// ============================================================================

describe('listMessagesAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await listMessagesAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns transformed messages', async () => {
    mockSessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            id: 'msg-1',
            role: 'user',
            time: { created: Date.now() },
          },
          parts: [{ type: 'text', text: 'Hello' }],
        },
        {
          info: {
            id: 'msg-2',
            role: 'assistant',
            time: { created: Date.now() },
          },
          parts: [{ type: 'text', text: 'Hi there' }],
        },
      ],
    })

    const result = await listMessagesAction('alice', 'sess-1')

    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(2)
    expect(result.messages![0].role).toBe('user')
    expect(result.messages![1].role).toBe('assistant')
  })

  it('skips messages with unknown roles', async () => {
    mockSessionMessages.mockResolvedValue({
      data: [
        {
          info: { id: 'msg-1', role: 'unknown_role', time: {} },
          parts: [{ type: 'text', text: 'skip me' }],
        },
        {
          info: { id: 'msg-2', role: 'user', time: {} },
          parts: [{ type: 'text', text: 'keep me' }],
        },
      ],
    })

    const result = await listMessagesAction('alice', 'sess-1')

    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(1)
  })

  it('handles null data from messages call', async () => {
    mockSessionMessages.mockResolvedValue({ data: null })
    const result = await listMessagesAction('alice', 'sess-1')
    expect(result.ok).toBe(true)
    expect(result.messages).toEqual([])
  })

  it('handles status endpoint failure gracefully', async () => {
    mockSessionMessages.mockResolvedValue({ data: [] })
    mockSessionStatus.mockRejectedValue(new Error('status fail'))
    const result = await listMessagesAction('alice', 'sess-1')
    expect(result.ok).toBe(true)
  })

  it('handles exceptions', async () => {
    mockSessionMessages.mockRejectedValue(new Error('msg err'))
    const result = await listMessagesAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'msg err' })
  })

  it('extracts provider and model info from message info', async () => {
    mockSessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            id: 'msg-1',
            role: 'assistant',
            time: { created: Date.now() },
            providerID: 'openai',
            modelID: 'gpt-4',
          },
          parts: [{ type: 'text', text: 'response' }],
        },
      ],
    })

    const result = await listMessagesAction('alice', 'sess-1')

    expect(result.ok).toBe(true)
    expect(result.messages![0].model).toEqual({ providerId: 'openai', modelId: 'gpt-4' })
  })

  it('extracts provider and model from nested model object', async () => {
    mockSessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            id: 'msg-1',
            role: 'assistant',
            time: { created: Date.now() },
            model: { providerID: 'anthropic', modelID: 'claude-3' },
          },
          parts: [{ type: 'text', text: 'response' }],
        },
      ],
    })

    const result = await listMessagesAction('alice', 'sess-1')

    expect(result.ok).toBe(true)
    expect(result.messages![0].model).toEqual({ providerId: 'anthropic', modelId: 'claude-3' })
  })

  it('extracts agent id from message info', async () => {
    mockSessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            id: 'msg-1',
            role: 'assistant',
            time: { created: Date.now() },
            agent: 'researcher',
          },
          parts: [{ type: 'text', text: 'response' }],
        },
      ],
    })

    const result = await listMessagesAction('alice', 'sess-1')
    expect(result.messages![0].agentId).toBe('researcher')
  })
})

// ============================================================================
// sendMessageAction
// ============================================================================

describe('sendMessageAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await sendMessageAction('alice', 'sess-1', 'Hello')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns error when forbidden', async () => {
    const result = await sendMessageAction('bob', 'sess-1', 'Hello')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('returns error when instance is unavailable', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue(null as never)
    const result = await sendMessageAction('alice', 'sess-1', 'Hello')
    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('returns error when instance not running', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'stopped',
    } as never)
    const result = await sendMessageAction('alice', 'sess-1', 'Hello')
    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('returns error when instance has no password', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: null,
      status: 'running',
    } as never)
    const result = await sendMessageAction('alice', 'sess-1', 'Hello')
    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('sends message and parses JSON response', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'running',
    } as never)

    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        info: { id: 'msg-resp', role: 'assistant', time: { created: Date.now() } },
        parts: [{ type: 'text', text: 'Response text' }],
      })),
    }
    vi.mocked(fetch).mockResolvedValue(mockResponse as never)

    const result = await sendMessageAction('alice', 'sess-1', 'Hello')

    expect(result.ok).toBe(true)
    expect(result.message!.id).toBe('msg-resp')
    expect(result.message!.role).toBe('assistant')
  })

  it('sends message with model parameter', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'running',
    } as never)

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        info: { id: 'msg-resp' },
        parts: [{ type: 'text', text: 'ok' }],
      })),
    } as never)

    await sendMessageAction('alice', 'sess-1', 'Hello', {
      providerId: 'openai',
      modelId: 'gpt-4',
    })

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.model).toEqual({ providerID: 'openai', modelID: 'gpt-4' })
  })

  it('handles HTTP error response', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'running',
    } as never)

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as never)

    const result = await sendMessageAction('alice', 'sess-1', 'Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('HTTP 500: Internal Server Error')
  })

  it('handles NDJSON fallback when JSON parse fails', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'running',
    } as never)

    const ndjson = [
      JSON.stringify({ messageID: 'msg-ndjson', type: 'start' }),
      JSON.stringify({ type: 'text', text: 'Line 1' }),
      JSON.stringify({ type: 'text', text: 'Line 2' }),
    ].join('\n')

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(ndjson),
    } as never)

    const result = await sendMessageAction('alice', 'sess-1', 'Hello')

    expect(result.ok).toBe(true)
    expect(result.message!.id).toBe('msg-ndjson')
  })

  it('handles fetch exceptions', async () => {
    mockInstanceService.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted',
      status: 'running',
    } as never)

    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    const result = await sendMessageAction('alice', 'sess-1', 'Hello')

    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})

// ============================================================================
// Abort
// ============================================================================

describe('abortSessionAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await abortSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('aborts session successfully', async () => {
    mockSessionAbort.mockResolvedValue(undefined)
    const result = await abortSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: true })
    expect(mockSessionAbort).toHaveBeenCalledWith({ sessionID: 'sess-1' })
  })

  it('handles exceptions', async () => {
    mockSessionAbort.mockRejectedValue(new Error('abort err'))
    const result = await abortSessionAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'abort err' })
  })
})

// ============================================================================
// Diffs
// ============================================================================

describe('getWorkspaceDiffsAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await getWorkspaceDiffsAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns error when forbidden', async () => {
    const result = await getWorkspaceDiffsAction('bob')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('returns error when agent client unavailable', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue(null)
    const result = await getWorkspaceDiffsAction('alice')
    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('returns diffs, filtering hidden paths', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Basic test',
    })

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        diffs: [
          { path: 'src/index.ts', status: 'modified', additions: 1, deletions: 0, diff: '+line', conflicted: false },
          { path: '.arche/config.json', status: 'modified', additions: 1, deletions: 0, diff: '+line', conflicted: false },
        ],
      }),
      text: vi.fn(),
    } as never)

    const result = await getWorkspaceDiffsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.diffs).toHaveLength(1)
    expect(result.diffs![0].path).toBe('src/index.ts')
  })

  it('returns error when fetch response is not ok', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Basic test',
    })

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Server Error'),
    } as never)

    const result = await getWorkspaceDiffsAction('alice')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('workspace_agent_http_500')
  })

  it('returns error when agent response is not ok', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Basic test',
    })

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: false, error: 'git_error' }),
    } as never)

    const result = await getWorkspaceDiffsAction('alice')

    expect(result).toEqual({ ok: false, error: 'git_error' })
  })

  it('handles fetch exceptions', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Basic test',
    })

    vi.mocked(fetch).mockRejectedValue(new Error('network'))

    const result = await getWorkspaceDiffsAction('alice')

    expect(result).toEqual({ ok: false, error: 'network' })
  })

  it('handles non-Error thrown values', async () => {
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Basic test',
    })

    vi.mocked(fetch).mockRejectedValue('string error')

    const result = await getWorkspaceDiffsAction('alice')

    expect(result).toEqual({ ok: false, error: 'workspace_agent_unreachable' })
  })
})

describe('getSessionDiffsAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await getSessionDiffsAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns diffs with computed status', async () => {
    mockSessionDiff.mockResolvedValue({
      data: [
        { file: 'src/a.ts', before: 'old', after: 'new', additions: 1, deletions: 1 },
        { file: 'src/b.ts', before: '', after: 'new', additions: 1, deletions: 0 },
        { file: 'src/c.ts', before: 'old', after: '', additions: 0, deletions: 1 },
      ],
    })

    const result = await getSessionDiffsAction('alice', 'sess-1')

    expect(result.ok).toBe(true)
    expect(result.diffs![0].status).toBe('modified')
    expect(result.diffs![1].status).toBe('added')
    expect(result.diffs![2].status).toBe('deleted')
  })

  it('handles null data', async () => {
    mockSessionDiff.mockResolvedValue({ data: null })
    const result = await getSessionDiffsAction('alice', 'sess-1')
    expect(result.ok).toBe(true)
    expect(result.diffs).toEqual([])
  })

  it('handles exceptions', async () => {
    mockSessionDiff.mockRejectedValue(new Error('diff err'))
    const result = await getSessionDiffsAction('alice', 'sess-1')
    expect(result).toEqual({ ok: false, error: 'diff err' })
  })
})

// ============================================================================
// Agents
// ============================================================================

describe('listAgentsAction', () => {
  it('returns error when unauthorized', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await listAgentsAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns agents list', async () => {
    mockAppAgents.mockResolvedValue({
      data: [
        { name: 'researcher', description: 'Research agent' },
        { name: 'coder', description: 'Coding agent' },
      ],
    })

    const result = await listAgentsAction('alice')

    expect(result.ok).toBe(true)
    expect(result.agents).toEqual([
      { id: 'researcher', name: 'researcher', description: 'Research agent' },
      { id: 'coder', name: 'coder', description: 'Coding agent' },
    ])
  })

  it('handles null data', async () => {
    mockAppAgents.mockResolvedValue({ data: null })
    const result = await listAgentsAction('alice')
    expect(result.ok).toBe(true)
    expect(result.agents).toEqual([])
  })

  it('handles exceptions', async () => {
    mockAppAgents.mockRejectedValue(new Error('agents err'))
    const result = await listAgentsAction('alice')
    expect(result).toEqual({ ok: false, error: 'agents err' })
  })
})
