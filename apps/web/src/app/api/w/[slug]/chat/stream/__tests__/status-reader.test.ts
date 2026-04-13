import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUpstreamSessionStatusReader } from '@/app/api/w/[slug]/chat/stream/status-reader'

describe('createUpstreamSessionStatusReader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reuses a recent upstream status within the cache window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          'session-1': { type: 'busy' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const readStatus = createUpstreamSessionStatusReader({
      baseUrl: 'http://127.0.0.1:4096',
      authHeader: 'Basic token',
      sessionId: 'session-1',
    })

    await expect(readStatus()).resolves.toBe('busy')
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(readStatus()).resolves.toBe('busy')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('logs and returns null when the upstream status request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    const readStatus = createUpstreamSessionStatusReader({
      baseUrl: 'http://127.0.0.1:4096',
      authHeader: 'Basic token',
      sessionId: 'session-1',
    })

    await expect(readStatus()).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[chat-stream] Failed to read upstream session status',
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:4096',
        sessionId: 'session-1',
        error: 'socket hang up',
      }),
    )
  })
})
