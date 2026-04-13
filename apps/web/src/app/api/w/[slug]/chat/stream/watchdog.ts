export type IdleFinalizationOutcome = 'complete' | 'stream_incomplete' | 'stream_no_assistant_message'

export type SilentStreamOutcome = 'finalize_idle' | 'keep_waiting' | 'stream_timeout'

type IdleFinalizationInput = {
  resume: boolean
  assistantMessageSeen: boolean
  assistantPartSeen: boolean
}

export function getIdleFinalizationOutcome({
  resume,
  assistantMessageSeen,
  assistantPartSeen,
}: IdleFinalizationInput): IdleFinalizationOutcome {
  if (resume) {
    return 'complete'
  }

  if (!assistantMessageSeen) {
    return 'stream_no_assistant_message'
  }

  if (!assistantPartSeen) {
    return 'stream_incomplete'
  }

  return 'complete'
}

export function getSilentStreamOutcome(upstreamStatus: string | null): SilentStreamOutcome {
  if (upstreamStatus === 'busy' || upstreamStatus === 'retry') {
    return 'keep_waiting'
  }

  if (upstreamStatus === 'idle') {
    return 'finalize_idle'
  }

  return 'stream_timeout'
}
