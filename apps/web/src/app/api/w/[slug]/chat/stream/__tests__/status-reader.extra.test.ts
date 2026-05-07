import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUpstreamSessionStatusReader } from '@/app/api/w/[slug]/chat/stream/status-reader'

describe('createUpstreamSessionStatusReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns and caches upstream session status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ 'session-1': { type: 'busy' } })
      )
    )

    const readStatus = createUpstreamSessionStatusReader({
      baseUrl: 'http://agent',
      authHeader: 'Bearer token',
      sessionId: 'session-1',
    })

    await expect(readStatus()).resolves.toBe('busy')
    await expect(readStatus()).resolves.toBe('busy')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns null and caches failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 502 })))

    const readStatus = createUpstreamSessionStatusReader({
      baseUrl: 'http://agent',
      authHeader: 'Bearer token',
      sessionId: 'session-1',
    })

    await expect(readStatus()).resolves.toBeNull()
    await expect(readStatus()).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      '[chat-stream] Upstream session status request failed',
      expect.objectContaining({ status: 502 })
    )
  })

  it('returns null when upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const readStatus = createUpstreamSessionStatusReader({
      baseUrl: 'http://agent',
      authHeader: 'Bearer token',
      sessionId: 'session-1',
    })

    await expect(readStatus()).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      '[chat-stream] Failed to read upstream session status',
      expect.objectContaining({ error: 'offline' })
    )
  })
})
