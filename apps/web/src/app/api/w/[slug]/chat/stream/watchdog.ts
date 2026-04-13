export type IdleFinalizationOutcome =
  | 'complete'
  | 'resume_incomplete'
  | 'stream_incomplete'
  | 'stream_no_assistant_message'

export type SilentStreamOutcome = 'finalize_idle' | 'keep_waiting' | 'stream_timeout'

const SILENT_STREAM_TIMEOUT_MULTIPLIER = 3

type IdleFinalizationInput = {
  resume: boolean
  assistantMessageSeen: boolean
  assistantPartSeen: boolean
}

type SilentStreamInput = {
  upstreamStatus: string | null
  silentForMs: number
  relevantEventTimeoutMs: number
}

export function getIdleFinalizationOutcome({
  resume,
  assistantMessageSeen,
  assistantPartSeen,
}: IdleFinalizationInput): IdleFinalizationOutcome {
  if (resume) {
    return assistantPartSeen ? 'complete' : 'resume_incomplete'
  }

  if (!assistantMessageSeen) {
    return 'stream_no_assistant_message'
  }

  if (!assistantPartSeen) {
    return 'stream_incomplete'
  }

  return 'complete'
}

export function getSilentStreamOutcome({
  upstreamStatus,
  silentForMs,
  relevantEventTimeoutMs,
}: SilentStreamInput): SilentStreamOutcome {
  if (upstreamStatus === 'busy' || upstreamStatus === 'retry') {
    return silentForMs < relevantEventTimeoutMs * SILENT_STREAM_TIMEOUT_MULTIPLIER
      ? 'keep_waiting'
      : 'stream_timeout'
  }

  if (upstreamStatus === 'idle') {
    return 'finalize_idle'
  }

  return 'stream_timeout'
}
