import { describe, expect, it } from 'vitest'

import { getIdleFinalizationOutcome, getSilentStreamOutcome } from '@/app/api/w/[slug]/chat/stream/watchdog'

describe('chat stream watchdog helpers', () => {
  describe('getIdleFinalizationOutcome', () => {
    it('returns complete for resume streams', () => {
      expect(
        getIdleFinalizationOutcome({
          resume: true,
          assistantMessageSeen: false,
          assistantPartSeen: false,
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
      expect(getSilentStreamOutcome('busy')).toBe('keep_waiting')
      expect(getSilentStreamOutcome('retry')).toBe('keep_waiting')
    })

    it('finalizes when upstream has idled', () => {
      expect(getSilentStreamOutcome('idle')).toBe('finalize_idle')
    })

    it('falls back to stream timeout for unknown or missing upstream status', () => {
      expect(getSilentStreamOutcome(null)).toBe('stream_timeout')
      expect(getSilentStreamOutcome('complete')).toBe('stream_timeout')
    })
  })
})
