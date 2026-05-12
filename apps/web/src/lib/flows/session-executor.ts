import {
  captureSessionMessageCursor,
  readLatestAssistantText,
  waitForSessionToComplete,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'
import { flowService } from '@/lib/services'

const LEASE_EXTENSION_INTERVAL_MS = 60_000
export const FLOW_LEASE_MS = 15 * 60 * 1000

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

export async function createFlowLeaseOwner(): Promise<string> {
  const { randomUUID } = await importRuntimeModule<typeof import('crypto')>('crypto')
  return `flows:${process.pid}:${randomUUID()}`
}

export async function runFlowPromptAndReadOutput(params: {
  agent?: string | null
  client: SessionExecutionClient
  flowId: string
  leaseOwner: string
  prompt: string
  sessionId: string
  slug: string
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const cursor = await captureSessionMessageCursor(params.client, params.sessionId)
  await params.client.session.promptAsync(
    {
      agent: params.agent ?? undefined,
      parts: [{ text: params.prompt, type: 'text' }],
      sessionID: params.sessionId,
    },
    { throwOnError: true },
  )

  let lastLeaseExtensionAt = 0
  const failure = await waitForSessionToComplete({
    client: params.client,
    cursor,
    onPulse: async () => {
      if (Date.now() - lastLeaseExtensionAt < LEASE_EXTENSION_INTERVAL_MS) {
        return
      }

      await flowService.extendFlowLease(
        params.flowId,
        params.leaseOwner,
        new Date(Date.now() + FLOW_LEASE_MS),
      )
      lastLeaseExtensionAt = Date.now()
    },
    sessionId: params.sessionId,
    slug: params.slug,
  })

  if (failure) {
    return { ok: false, error: failure }
  }

  const output = await readLatestAssistantText(params.client, params.sessionId, cursor)
  if (!output) {
    return { ok: false, error: 'flow_no_assistant_output' }
  }

  return { ok: true, output }
}
