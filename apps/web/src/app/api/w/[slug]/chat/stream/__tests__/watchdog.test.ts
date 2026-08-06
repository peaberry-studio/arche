import { describe, expect, it } from 'vitest'

import { getIdleFinalizationOutcome, getSilentStreamOutcome } from '@/app/api/w/[slug]/chat/stream/watchdog'

describe('chat stream watchdog helpers', () => {
  describe('getIdleFinalizationOutcome', () => {
    it('returns resume_incomplete for silent resume streams', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: true,
          assistantMessageSeen: false,
          assistantPartSeen: false,
        }),
      ).toBe('resume_incomplete')
    })

    it('returns complete for resume streams once assistant parts arrive', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: true,
          assistantMessageSeen: true,
          assistantPartSeen: true,
        }),
      ).toBe('complete')
    })

    it('requires an assistant message for send streams', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: false,
          assistantMessageSeen: false,
          assistantPartSeen: false,
        }),
      ).toBe('stream_no_assistant_message')
    })

    it('requires an assistant part once the message exists', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: false,
          assistantMessageSeen: true,
          assistantPartSeen: false,
        }),
      ).toBe('stream_incomplete')
    })

    it('completes when send streams have assistant parts', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: false,
          assistantMessageSeen: true,
          assistantPartSeen: true,
        }),
      ).toBe('complete')
    })
  })

  describe('getSilentStreamOutcome', () => {
    it('keeps waiting while upstream remains busy', () => {
      expect(getSilentStreamOutcome({
        maxRuntimeMs: 35 * 60 * 1000,
        runtimeMs: 19_999,
        upstreamStatus: 'busy',
        silentForMs: 19_999,
        relevantEventTimeoutMs: 20_000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
      expect(getSilentStreamOutcome({
        maxRuntimeMs: 35 * 60 * 1000,
        runtimeMs: 35_999,
        upstreamStatus: 'retry',
        silentForMs: 35_999,
        relevantEventTimeoutMs: 12_000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
    })

    it('keeps waiting through extended silence while upstream stays busy', () => {
      expect(getSilentStreamOutcome({
        upstreamStatus: 'busy',
        silentForMs: 60_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 60_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
      expect(getSilentStreamOutcome({
        upstreamStatus: 'retry',
        silentForMs: 36_000,
        relevantEventTimeoutMs: 12_000,
        runtimeMs: 36_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
    })

    it('times out only when the explicit max runtime is reached', () => {
      expect(getSilentStreamOutcome({
        upstreamStatus: 'busy',
        silentForMs: 60_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 35 * 60 * 1000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('max_runtime_exceeded')
    })

    it('finalizes when upstream has idled', () => {
      expect(getSilentStreamOutcome({
        upstreamStatus: 'idle',
        silentForMs: 20_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 20_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 0,
        unknownStatusGraceMs: 45_000,
      })).toBe('finalize_idle')
    })

    it('keeps waiting for unknown status during the grace window', () => {
      expect(getSilentStreamOutcome({
        upstreamStatus: null,
        silentForMs: 20_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 20_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 30_000,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
      expect(getSilentStreamOutcome({
        upstreamStatus: 'complete',
        silentForMs: 20_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 20_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 30_000,
        unknownStatusGraceMs: 45_000,
      })).toBe('keep_waiting')
    })

    it('ends observation only after unknown status exhausts its grace window', () => {
      expect(getSilentStreamOutcome({
        upstreamStatus: null,
        silentForMs: 65_000,
        relevantEventTimeoutMs: 20_000,
        runtimeMs: 65_000,
        maxRuntimeMs: 35 * 60 * 1000,
        unknownStatusForMs: 45_000,
        unknownStatusGraceMs: 45_000,
      })).toBe('status_unknown_timeout')
    })
  })
})
