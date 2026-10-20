/** @vitest-environment jsdom */

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceActiveSessionEffects } from '@/hooks/workspace/use-workspace-active-session-effects'

afterEach(cleanup)

describe('useWorkspaceActiveSessionEffects', () => {
  it('hydrates an archive while offline and refreshes it again on reconnect', () => {
    const refreshMessages = vi.fn(async () => undefined)
    const ensureSessionFamilyLoaded = vi.fn(async () => undefined)
    const { rerender } = renderHook(({ isConnected }) => useWorkspaceActiveSessionEffects({
      activeSessionId: 'old', enabled: isConnected, isArchived: true, isConnected,
      refreshMessages, ensureSessionFamilyLoaded,
    }), { initialProps: { isConnected: false } })
    expect(refreshMessages).toHaveBeenCalledWith('old')
    expect(ensureSessionFamilyLoaded).toHaveBeenCalledWith('old')
    rerender({ isConnected: true })
    expect(refreshMessages).toHaveBeenCalledTimes(2)
  })

  it('still waits for a connection before hydrating live sessions', () => {
    const refreshMessages = vi.fn(async () => undefined)
    const ensureSessionFamilyLoaded = vi.fn(async () => undefined)
    renderHook(() => useWorkspaceActiveSessionEffects({
      activeSessionId: 'live', enabled: true, isConnected: false,
      refreshMessages, ensureSessionFamilyLoaded,
    }))
    expect(refreshMessages).not.toHaveBeenCalled()
    expect(ensureSessionFamilyLoaded).not.toHaveBeenCalled()
  })
})
