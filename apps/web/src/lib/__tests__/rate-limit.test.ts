import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('rate-limit', () => {
  let rateLimit: typeof import('../rate-limit')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    rateLimit = await import('../rate-limit')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests under the limit', () => {
    const result = rateLimit.checkRateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks after max attempts', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit.checkRateLimit('test-key', 5, 60000)
    }
    const result = rateLimit.checkRateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after window expires', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit.checkRateLimit('test-key', 5, 60000)
    }
    vi.advanceTimersByTime(60001)
    const result = rateLimit.checkRateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(true)
  })

  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit.checkRateLimit('key-a', 5, 60000)
    }
    const result = rateLimit.checkRateLimit('key-b', 5, 60000)
    expect(result.allowed).toBe(true)
  })

  it('resetRateLimit clears the key', () => {
    for (let i = 0; i < 5; i++) {
      rateLimit.checkRateLimit('test-key', 5, 60000)
    }
    rateLimit.resetRateLimit('test-key')
    const result = rateLimit.checkRateLimit('test-key', 5, 60000)
    expect(result.allowed).toBe(true)
  })
})
