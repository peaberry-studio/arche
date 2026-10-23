import { vi } from 'vitest'

import type { HarnessMessage, HarnessRuntime, HarnessSession } from '@/lib/harness/contract'

export function message(input: Partial<HarnessMessage> = {}): HarnessMessage {
  return {
    id: 'message-1', sessionId: 'session-1', role: 'assistant', content: '', timestamp: '',
    parts: [{ type: 'text', id: 'part-1', text: 'Done' }],
    ...input,
  }
}

export function session(id = 'session-1'): HarnessSession {
  return { id, title: 'Session', status: 'idle', updatedAt: '' }
}

export function fakeRuntime() {
  return {
    kind: 'opencode-v1' as const,
    slug: 'slack-bot',
    health: vi.fn<HarnessRuntime['health']>().mockResolvedValue({ ok: true, data: {} }),
    createSession: vi.fn<HarnessRuntime['createSession']>().mockResolvedValue({ ok: true, data: session() }),
    getSession: vi.fn<HarnessRuntime['getSession']>().mockResolvedValue({ ok: true, data: session() }),
    listSessions: vi.fn<HarnessRuntime['listSessions']>().mockResolvedValue({ ok: true, data: [] }),
    listChildren: vi.fn<HarnessRuntime['listChildren']>().mockResolvedValue({ ok: true, data: [] }),
    updateSession: vi.fn<HarnessRuntime['updateSession']>().mockResolvedValue({ ok: true, data: session() }),
    deleteSession: vi.fn<HarnessRuntime['deleteSession']>().mockResolvedValue({ ok: true, data: undefined }),
    sessionStatus: vi.fn<HarnessRuntime['sessionStatus']>().mockResolvedValue({ ok: true, data: { 'session-1': { type: 'idle' } } }),
    listMessages: vi.fn<HarnessRuntime['listMessages']>().mockResolvedValue({ ok: true, data: [message()] }),
    prompt: vi.fn<HarnessRuntime['prompt']>().mockResolvedValue({ ok: true, data: undefined }),
    sendMessage: vi.fn<HarnessRuntime['sendMessage']>().mockResolvedValue({ ok: true, data: message() }),
    abortSession: vi.fn<HarnessRuntime['abortSession']>().mockResolvedValue({ ok: true, data: undefined }),
    listPermissions: vi.fn<HarnessRuntime['listPermissions']>().mockResolvedValue({ ok: true, data: [] }),
    replyPermission: vi.fn<HarnessRuntime['replyPermission']>().mockResolvedValue({ ok: true, data: undefined }),
    listModels: vi.fn<HarnessRuntime['listModels']>().mockResolvedValue({ ok: true, data: [] }),
    listAgents: vi.fn<HarnessRuntime['listAgents']>().mockResolvedValue({ ok: true, data: [] }),
    listConnectorKeys: vi.fn<HarnessRuntime['listConnectorKeys']>().mockResolvedValue({ ok: true, data: [] }),
    listConnectorStatus: vi.fn<HarnessRuntime['listConnectorStatus']>().mockResolvedValue({ ok: true, data: {} }),
    sessionDiff: vi.fn<HarnessRuntime['sessionDiff']>().mockResolvedValue({ ok: true, data: [] }),
    syncProviderAccess: vi.fn<HarnessRuntime['syncProviderAccess']>().mockResolvedValue({ ok: true, data: undefined }),
    subscribeEvents: vi.fn<HarnessRuntime['subscribeEvents']>(),
  } satisfies HarnessRuntime
}
