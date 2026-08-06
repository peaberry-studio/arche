export type IdleFinalizationOutcome =
  | 'complete'
  | 'resume_incomplete'
  | 'stream_incomplete'
  | 'stream_no_assistant_message'

export type SilentStreamOutcome =
  | 'finalize_idle'
  | 'keep_waiting'
  | 'max_runtime_exceeded'
  | 'status_unknown_timeout'

type IdleFinalizationInput = {
  resume: boolean
  assistantMessageSeen: boolean
  assistantPartSeen: boolean
}

type SilentStreamInput = {
  maxRuntimeMs: number
  runtimeMs: number
  upstreamStatus: string | null
  silentForMs: number
  relevantEventTimeoutMs: number
  unknownStatusForMs: number
  unknownStatusGraceMs: number
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

export function getSilentStreamOutcome(input: SilentStreamInput): SilentStreamOutcome {
  if (input.runtimeMs >= input.maxRuntimeMs) {
    return 'max_runtime_exceeded'
  }

  if (input.upstreamStatus === 'busy' || input.upstreamStatus === 'retry') {
    return 'keep_waiting'
  }

  if (input.upstreamStatus === 'idle') {
    return 'finalize_idle'
  }

  return input.unknownStatusForMs >= input.unknownStatusGraceMs
    ? 'status_unknown_timeout'
    : 'keep_waiting'
}
