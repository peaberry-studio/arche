import {
  captureSessionMessageCursor,
  type SessionExecutionClient,
} from '@/lib/harness/execution'

export async function openCodeSessionExists(
  client: SessionExecutionClient,
  sessionId: string,
): Promise<boolean> {
  try {
    await captureSessionMessageCursor(client, sessionId)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'session_not_found') {
      return false
    }

    throw error
  }
}
