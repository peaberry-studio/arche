import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockHarnessRuntime } from '@/actions/__tests__/helpers/harness-runtime'
import {
  abortSessionAction,
  checkConnectionAction,
  createSessionAction,
  deleteSessionAction,
  getSessionDiffsAction,
  getWorkspaceDiffsAction,
  listAgentsAction,
  listFilesAction,
  listMessagesAction,
  listPermissionsAction,
  loadFileTreeAction,
  markFlowRunSeenAction,
  readFileAction,
  searchFilesAction,
  sendMessageAction,
  updateSessionAction,
} from '@/actions/workspace-sessions'
import { abortSessionFamilyAndConfirmIdle, readSessionFamilyRuntimeState } from '@/lib/harness/execution'
import { getRuntimeForSlug, listWorkspaceFiles, readWorkspaceFile, searchWorkspaceFiles } from '@/lib/harness/registry'
import { getSession } from '@/lib/runtime/session'
import { flowService, messageRunService, slackService, userService } from '@/lib/services'
import * as legacySessionArchive from '@/lib/services/legacy-session-archive'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

vi.mock('@/lib/runtime/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/services/legacy-session-archive', () => ({ findSession: vi.fn(), listSessions: vi.fn(), isArchivedSession: vi.fn() }))
vi.mock('@/lib/harness/registry', () => ({
  getRuntimeForSlug: vi.fn(), listWorkspaceFiles: vi.fn(), readWorkspaceFile: vi.fn(), searchWorkspaceFiles: vi.fn(),
}))
vi.mock('@/lib/harness/execution', () => ({ abortSessionFamilyAndConfirmIdle: vi.fn(), readSessionFamilyRuntimeState: vi.fn() }))
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: vi.fn() }))
vi.mock('@/lib/services', () => ({
  flowService: { markRunResultSeenByIdForScope: vi.fn() },
  messageRunService: { abortActiveRun: vi.fn() },
  slackService: { deleteSessionBindingsByOpenCodeSessionId: vi.fn() },
  userService: { findIdBySlug: vi.fn() },
}))

const runtime = createMockHarnessRuntime()
const owner = {
  user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' as const },
  sessionId: 'auth-1',
}
const session = { id: 's1', title: 'Title', status: 'idle' as const, updatedAt: 'Today', updatedAtRaw: 100, parentId: 'parent' }
const message = {
  id: 'm1', sessionId: 's1', role: 'assistant' as const, content: 'Response', timestamp: 'Today',
  agentId: 'researcher', model: { providerId: 'openai', modelId: 'test' },
  parts: [{ type: 'text' as const, text: 'Response' }],
}
const success = <T,>(data: T) => ({ ok: true as const, data })
const failure = (code: 'runtime_error' | 'session_not_found' | 'healthcheck_timeout' | 'unhealthy_response' = 'runtime_error') => ({ ok: false as const, error: { code, detail: 'Harness detail' } })
const agent = { baseUrl: 'http://agent:8080', authHeader: 'Basic test' }
function agentResponse(data: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(data), { status }))
}
const entry = (path: string, type: 'file' | 'directory' = 'file') => ({ id: path, path, name: path.split('/').at(-1) ?? path, type })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(legacySessionArchive.findSession).mockResolvedValue(null)
  vi.mocked(legacySessionArchive.isArchivedSession).mockResolvedValue(false)
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(getSession).mockResolvedValue(owner)
  vi.mocked(getRuntimeForSlug).mockResolvedValue(success(runtime))
  vi.mocked(createWorkspaceAgentClient).mockResolvedValue(agent)
  runtime.sessionStatus.mockResolvedValue(success({}))
  vi.mocked(abortSessionFamilyAndConfirmIdle).mockResolvedValue(true)
  vi.mocked(readSessionFamilyRuntimeState).mockResolvedValue('idle')
  vi.mocked(messageRunService.abortActiveRun).mockResolvedValue(undefined)
  vi.mocked(slackService.deleteSessionBindingsByOpenCodeSessionId).mockResolvedValue({ dm: 0, thread: 0 })
})

describe('workspace action authorization', () => {
  const calls = [
    () => createSessionAction('alice'), () => deleteSessionAction('alice', 's1'),
    () => updateSessionAction('alice', 's1', 'title'),
    () => sendMessageAction('alice', 's1', 'Hello'), () => abortSessionAction('alice', 's1'),
    () => listPermissionsAction('alice'), () => listAgentsAction('alice'),
    () => getSessionDiffsAction('alice', 's1'), () => getWorkspaceDiffsAction('alice'),
    () => listFilesAction('alice'), () => readFileAction('alice', 'src/a.ts'),
    () => searchFilesAction('alice', 'a'), () => loadFileTreeAction('alice'),
    () => markFlowRunSeenAction('alice', 'run-1'),
  ]
  it.each(calls.map((call, i) => [i, call] as const))('rejects unauthenticated action %s before contacting services', async (_i, call) => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await call()).toEqual({ ok: false, error: 'unauthorized' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(legacySessionArchive.findSession).not.toHaveBeenCalled()
    expect(legacySessionArchive.isArchivedSession).not.toHaveBeenCalled()
    expect(createWorkspaceAgentClient).not.toHaveBeenCalled()
    expect(listWorkspaceFiles).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(searchWorkspaceFiles).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(calls.map((call, i) => [i, call] as const))('rejects another workspace for action %s', async (_i, call) => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'bob' } })
    expect(await call()).toEqual({ ok: false, error: 'forbidden' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(legacySessionArchive.findSession).not.toHaveBeenCalled()
    expect(legacySessionArchive.isArchivedSession).not.toHaveBeenCalled()
    expect(createWorkspaceAgentClient).not.toHaveBeenCalled()
    expect(listWorkspaceFiles).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(searchWorkspaceFiles).not.toHaveBeenCalled()
  })
})

describe('connection', () => {
  it('uses the bounded runtime health primitive', async () => {
    runtime.health.mockResolvedValue(success({ version: '1.0' }))
    expect(await checkConnectionAction('alice')).toEqual({ status: 'connected', version: '1.0' })
    expect(runtime.health).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
  })
  it.each([
    ['healthcheck_timeout', 'health_check_timeout'], ['unhealthy_response', 'unhealthy'],
  ] as const)('keeps the existing UI error for %s', async (code, error) => {
    runtime.health.mockResolvedValue(failure(code))
    expect(await checkConnectionAction('alice')).toEqual({ status: 'error', error })
  })
  it('does not resolve a runtime for unauthorized users', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await checkConnectionAction('alice')).toEqual({ status: 'error', error: 'unauthorized' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
  })
  it('allows admins', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'admin', role: 'ADMIN' } })
    runtime.health.mockResolvedValue(success({}))
    expect(await checkConnectionAction('alice')).toEqual({ status: 'connected', version: 'unknown' })
  })
})

describe('session mutations and bookkeeping', () => {
  it.each([
    ['delete', () => deleteSessionAction('alice', 's1')],
    ['rename', () => updateSessionAction('alice', 's1', 'New')],
    ['prompt', () => sendMessageAction('alice', 's1', 'Hello')],
    ['abort', () => abortSessionAction('alice', 's1')],
  ] as const)('rejects archived %s before resolving an offline runtime', async (_name, action) => {
    vi.mocked(legacySessionArchive.isArchivedSession).mockResolvedValue(true)
    expect(await action()).toEqual({ ok: false, error: 'session_archived' })
    expect(legacySessionArchive.isArchivedSession).toHaveBeenCalledWith('alice', 's1')
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(abortSessionFamilyAndConfirmIdle).not.toHaveBeenCalled()
    expect(slackService.deleteSessionBindingsByOpenCodeSessionId).not.toHaveBeenCalled()
    expect(messageRunService.abortActiveRun).not.toHaveBeenCalled()
  })

  it.each(['USER', 'ADMIN'] as const)('reads an archived snapshot offline as %s', async (role) => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, role, slug: role === 'ADMIN' ? 'admin' : 'alice' } })
    vi.mocked(legacySessionArchive.findSession).mockResolvedValue({ session: { ...session, archived: true }, messages: [message] })
    expect(await listMessagesAction('alice', 's1')).toEqual({ ok: true, archived: true, messages: [message], sessionRuntimeStatus: 'idle' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(runtime.sessionStatus).not.toHaveBeenCalled()
  })
  it('creates and updates normalized sessions', async () => {
    runtime.createSession.mockResolvedValue(success(session))
    runtime.updateSession.mockResolvedValue(success({ ...session, title: 'New' }))
    expect(await createSessionAction('alice', 'Title')).toEqual({ ok: true, session: { ...session, status: 'active' } })
    expect(await updateSessionAction('alice', 's1', 'New')).toEqual({ ok: true, session: { ...session, title: 'New' } })
    expect(runtime.createSession).toHaveBeenCalledWith({ title: 'Title' })
    expect(runtime.updateSession).toHaveBeenCalledWith('s1', 'New')
  })
  it('defaults empty titles to Untitled', async () => {
    runtime.createSession.mockResolvedValue(success({ ...session, title: '' }))
    expect((await createSessionAction('alice')).session?.title).toBe('Untitled')
  })
  it('removes Slack bindings only after successful deletion', async () => {
    runtime.deleteSession.mockResolvedValue(failure('session_not_found'))
    expect(await deleteSessionAction('alice', 's1')).toEqual({ ok: false, error: 'session_not_found' })
    expect(slackService.deleteSessionBindingsByOpenCodeSessionId).not.toHaveBeenCalled()
    runtime.deleteSession.mockResolvedValue(success(undefined))
    expect(await deleteSessionAction('alice', 's1')).toEqual({ ok: true })
    expect(slackService.deleteSessionBindingsByOpenCodeSessionId).toHaveBeenCalledWith('s1')
    expect(runtime.deleteSession).toHaveBeenCalledWith('s1')
  })
  it('confirms family termination before unlocking the active run', async () => {
    vi.mocked(abortSessionFamilyAndConfirmIdle).mockResolvedValue(false)
    expect(await abortSessionAction('alice', 's1')).toEqual({ ok: false, error: 'execution_termination_unconfirmed' })
    expect(messageRunService.abortActiveRun).not.toHaveBeenCalled()
    vi.mocked(abortSessionFamilyAndConfirmIdle).mockResolvedValue(true)
    expect(await abortSessionAction('alice', 's1')).toEqual({ ok: true })
    expect(abortSessionFamilyAndConfirmIdle).toHaveBeenLastCalledWith({ client: runtime, rootSessionId: 's1' })
    expect(messageRunService.abortActiveRun).toHaveBeenCalledWith('alice', 's1')
  })
  it('marks results seen in the target workspace scope for admins', async () => {
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'admin', role: 'ADMIN' } })
    vi.mocked(userService.findIdBySlug).mockResolvedValue({ id: 'target' })
    vi.mocked(flowService.markRunResultSeenByIdForScope).mockResolvedValue(true)
    expect(await markFlowRunSeenAction('alice', 'run-1')).toEqual({ ok: true })
    expect(flowService.markRunResultSeenByIdForScope).toHaveBeenCalledWith('run-1', expect.objectContaining({ workspaceUserId: 'target' }), expect.any(Date))
  })
  it('reports missing target users and runs', async () => {
    expect(await markFlowRunSeenAction('alice', 'missing')).toEqual({ ok: false, error: 'not_found' })
    vi.mocked(getSession).mockResolvedValue({ ...owner, user: { ...owner.user, slug: 'admin', role: 'ADMIN' } })
    vi.mocked(userService.findIdBySlug).mockResolvedValue(null)
    expect(await markFlowRunSeenAction('alice', 'missing')).toEqual({ ok: false, error: 'user_not_found' })
  })
})

describe('normalized message snapshots and sends', () => {
  it.each(['busy', 'unknown'] as const)('rejects a %s family before synchronous dispatch', async (state) => {
    vi.mocked(readSessionFamilyRuntimeState).mockResolvedValue(state)
    expect(await sendMessageAction('alice', 's1', 'Hello')).toEqual({ ok: false, error: 'session_busy' })
    expect(readSessionFamilyRuntimeState).toHaveBeenCalledWith(runtime, 's1')
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })
  it.each(['busy', 'retry', 'idle', 'unknown'] as const)('hydrates messages with %s status without grafting permissions', async (type) => {
    runtime.listMessages.mockResolvedValue(success([message]))
    runtime.sessionStatus.mockResolvedValue(success({ s1: { type } }))
    expect(await listMessagesAction('alice', 's1')).toEqual({ ok: true, messages: [message], sessionRuntimeStatus: type === 'retry' ? 'busy' : type })
    expect(runtime.listPermissions).not.toHaveBeenCalled()
  })
  it('keeps the snapshot when status fails', async () => {
    runtime.listMessages.mockResolvedValue(success([message]))
    runtime.sessionStatus.mockResolvedValue(failure())
    expect((await listMessagesAction('alice', 's1')).sessionRuntimeStatus).toBe('unknown')
  })
  it('sends Arche parts/model and returns the normalized synchronous response', async () => {
    runtime.sendMessage.mockResolvedValue(success(message))
    expect(await sendMessageAction('alice', 's1', 'Hello', message.model)).toEqual({ ok: true, message })
    expect(runtime.sendMessage).toHaveBeenCalledWith({ sessionId: 's1', parts: [{ type: 'text', text: 'Hello' }], model: message.model })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('surfaces typed errors without leaking wire details', async () => {
    runtime.sendMessage.mockResolvedValue(failure('session_not_found'))
    expect(await sendMessageAction('alice', 's1', 'Hello')).toEqual({ ok: false, error: 'session_not_found' })
  })
})

describe('normalized permissions, diffs and agents', () => {
  it('groups normalized permissions by session', async () => {
    const permissions = ['s1', 's2', 's1'].map((sessionId, i) => ({ id: `p${i}`, sessionId, title: 'Edit', state: 'pending' as const }))
    runtime.listPermissions.mockResolvedValue(success(permissions))
    expect(await listPermissionsAction('alice')).toEqual({ ok: true, permissions: { s1: [permissions[0], permissions[2]], s2: [permissions[1]] } })
  })
  it('returns session diffs and agent identifiers unchanged', async () => {
    const diffs = [{ path: 'a.ts', status: 'added' as const, additions: 1, deletions: 0, diff: '+a' }]
    const agents = [{ id: 'agent-id', name: 'Display name', description: 'Research' }]
    runtime.sessionDiff.mockResolvedValue(success(diffs))
    runtime.listAgents.mockResolvedValue(success(agents))
    expect(await getSessionDiffsAction('alice', 's1')).toEqual({ ok: true, diffs })
    expect(await listAgentsAction('alice')).toEqual({ ok: true, agents })
  })
  it('returns contract failures', async () => {
    runtime.listPermissions.mockResolvedValue(failure())
    runtime.sessionDiff.mockResolvedValue(failure())
    runtime.listAgents.mockResolvedValue(failure())
    for (const result of [await listPermissionsAction('alice'), await getSessionDiffsAction('alice', 's1'), await listAgentsAction('alice')]) {
      expect(result).toEqual({ ok: false, error: 'runtime_error' })
    }
  })
})

describe('temporary file forwarding and workspace-agent diffs', () => {
  it('lists normalized files through the named boundary without using the sidecar', async () => {
    vi.mocked(listWorkspaceFiles).mockResolvedValue(success([entry('src')]))
    expect(await listFilesAction('alice', 'src')).toEqual({ ok: true, files: [{ id: 'src', path: 'src', name: 'src', type: 'file' }] })
    expect(listWorkspaceFiles).toHaveBeenCalledWith('alice', 'src')
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(createWorkspaceAgentClient).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['opencode.json', 'node_modules/a', '../secret'])('rejects protected read path %s', async (path) => {
    expect(await readFileAction('alice', path)).toEqual({ ok: false, error: 'protected_path' })
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns normalized file content from the boundary', async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue(success({ path: 'src/a.ts', content: 'decoded', type: 'raw' }))
    expect(await readFileAction('alice', 'src/a.ts')).toEqual({ ok: true, content: { path: 'src/a.ts', content: 'decoded', type: 'raw' } })
    expect(readWorkspaceFile).toHaveBeenCalledWith('alice', 'src/a.ts')
  })
  it('preserves missing file errors and boundary failure details', async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({ ok: false, error: { code: 'runtime_error', detail: 'file_not_found' } })
    expect(await readFileAction('alice', 'missing')).toEqual({ ok: false, error: 'file_not_found' })
    vi.mocked(listWorkspaceFiles).mockResolvedValue({ ok: false, error: { code: 'runtime_error', detail: 'list_failed' } })
    expect(await listFilesAction('alice')).toEqual({ ok: false, error: 'list_failed' })
  })
  it('forwards noncontiguous fuzzy queries unchanged without recursive file scans', async () => {
    vi.mocked(searchWorkspaceFiles).mockResolvedValue(success(['src/workspace-session.ts']))
    expect(await searchFilesAction('alice', 'wSsn')).toEqual({ ok: true, files: ['src/workspace-session.ts'] })
    expect(searchWorkspaceFiles).toHaveBeenCalledWith('alice', 'wSsn')
    expect(listWorkspaceFiles).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('builds directory-first trees and respects maxDepth', async () => {
    vi.mocked(listWorkspaceFiles)
      .mockResolvedValueOnce(success([entry('z.md'), entry('.git', 'directory'), entry('node_modules', 'directory'), entry('src', 'directory')]))
      .mockResolvedValueOnce(success([entry('src/nested', 'directory')]))
    expect(await loadFileTreeAction('alice', 1)).toEqual({ ok: true, tree: [
      { id: 'src', path: 'src', name: 'src', type: 'directory', children: [{ id: 'src/nested', path: 'src/nested', name: 'nested', type: 'directory' }] },
      { id: 'z.md', path: 'z.md', name: 'z.md', type: 'file' },
    ] })
    expect(listWorkspaceFiles).toHaveBeenCalledTimes(2)
    expect(listWorkspaceFiles).toHaveBeenNthCalledWith(1, 'alice', '')
    expect(listWorkspaceFiles).toHaveBeenNthCalledWith(2, 'alice', 'src')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('filters hidden workspace diffs', async () => {
    const diff = { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, diff: '+a', conflicted: false }
    agentResponse({ ok: true, diffs: [diff, { ...diff, path: '.arche/config' }] })
    expect(await getWorkspaceDiffsAction('alice')).toEqual({ ok: true, diffs: [diff] })
  })
  it('reports unavailable file clients through the boundary', async () => {
    vi.mocked(listWorkspaceFiles).mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })
    expect(await listFilesAction('alice')).toEqual({ ok: false, error: 'instance_unavailable' })
    expect(getRuntimeForSlug).not.toHaveBeenCalled()
    expect(createWorkspaceAgentClient).not.toHaveBeenCalled()
  })
})
