import { vi } from 'vitest'

import type { HarnessRuntime } from '@/lib/harness/contract'

export function createMockHarnessRuntime() {
  return {
    kind: 'opencode-v1',
    slug: 'alice',
    health: vi.fn<HarnessRuntime['health']>(),
    createSession: vi.fn<HarnessRuntime['createSession']>(),
    getSession: vi.fn<HarnessRuntime['getSession']>(),
    listSessions: vi.fn<HarnessRuntime['listSessions']>(),
    listChildren: vi.fn<HarnessRuntime['listChildren']>(),
    updateSession: vi.fn<HarnessRuntime['updateSession']>(),
    deleteSession: vi.fn<HarnessRuntime['deleteSession']>(),
    sessionStatus: vi.fn<HarnessRuntime['sessionStatus']>(),
    listMessages: vi.fn<HarnessRuntime['listMessages']>(),
    prompt: vi.fn<HarnessRuntime['prompt']>(),
    sendMessage: vi.fn<HarnessRuntime['sendMessage']>(),
    abortSession: vi.fn<HarnessRuntime['abortSession']>(),
    listPermissions: vi.fn<HarnessRuntime['listPermissions']>(),
    replyPermission: vi.fn<HarnessRuntime['replyPermission']>(),
    listModels: vi.fn<HarnessRuntime['listModels']>(),
    listAgents: vi.fn<HarnessRuntime['listAgents']>(),
    listConnectorKeys: vi.fn<HarnessRuntime['listConnectorKeys']>(),
    listConnectorStatus: vi.fn<HarnessRuntime['listConnectorStatus']>(),
    sessionDiff: vi.fn<HarnessRuntime['sessionDiff']>(),
    syncProviderAccess: vi.fn<HarnessRuntime['syncProviderAccess']>(),
    subscribeEvents: vi.fn<HarnessRuntime['subscribeEvents']>(),
  } satisfies HarnessRuntime
}
