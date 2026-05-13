import {
  captureSessionMessageCursor,
  isOpenCodeSessionNotFoundError,
  type SessionExecutionClient,
} from '@/lib/opencode/session-execution'

export async function openCodeSessionExists(
  client: SessionExecutionClient,
  sessionId: string,
): Promise<boolean> {
  try {
    await captureSessionMessageCursor(client, sessionId)
    return true
  } catch (error) {
    if (isOpenCodeSessionNotFoundError(error)) {
      return false
    }

    throw error
  }
}
