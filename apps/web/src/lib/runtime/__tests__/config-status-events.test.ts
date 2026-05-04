import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsDesktop = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => mockIsDesktop(),
}))

import {
  getConfigChangeMessage,
  notifyWorkspaceConfigChanged,
  WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
} from '../config-status-events'

describe('config-status-events', () => {
  describe('getConfigChangeMessage', () => {
    it('returns provider sync message', () => {
      expect(getConfigChangeMessage('provider_sync')).toBe('Provider changes need a workspace restart to apply.')
    })

    it('returns generic config message for config reason', () => {
      expect(getConfigChangeMessage('config')).toBe('Configuration changes detected. Restart to apply them.')
    })

    it('returns generic message for null reason', () => {
      expect(getConfigChangeMessage(null)).toBe('Configuration changes detected. Restart to apply them.')
    })
  })

  describe('notifyWorkspaceConfigChanged', () => {
    it('does nothing when window is undefined', () => {
      expect(() => notifyWorkspaceConfigChanged()).not.toThrow()
    })

    it('dispatches event on window when available', () => {
      const dispatchEventSpy = vi.fn()
      // @ts-expect-error - mocking window
      globalThis.window = { dispatchEvent: dispatchEventSpy }

      notifyWorkspaceConfigChanged()

      expect(dispatchEventSpy).toHaveBeenCalledOnce()
      const event = dispatchEventSpy.mock.calls[0][0] as Event
      expect(event.type).toBe(WORKSPACE_CONFIG_STATUS_CHANGED_EVENT)
    })
  })
})
