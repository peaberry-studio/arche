import { useLayoutEffect, useRef } from 'react'

export type AddConnectorSubmissionResult =
  | { ok: true; name: string; config: Record<string, unknown> }
  | { ok: false; message: string }

export type AddConnectorSectionHandle = {
  isComplete: () => boolean
  getSubmission: () => AddConnectorSubmissionResult
}

export type AddConnectorSectionProps = {
  onStateChange: () => void
  isActive: boolean
}

export function useNotifyStateChange(
  onStateChange: () => void,
  stateSnapshot: Record<string, unknown>
) {
  const isFirstRender = useRef(true)
  const prevRef = useRef(stateSnapshot)

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      prevRef.current = stateSnapshot
      onStateChange()
      return
    }

    const prev = prevRef.current
    const keys = Object.keys(stateSnapshot)
    const changed = keys.some((key) => prev[key] !== stateSnapshot[key])
    if (changed) {
      prevRef.current = stateSnapshot
      onStateChange()
    }
  }, [onStateChange, stateSnapshot])
}
