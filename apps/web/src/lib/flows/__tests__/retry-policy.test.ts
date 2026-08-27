import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getFlowMaxRetryAttempts,
  getFlowRetryBackoffMs,
  isRetryableFlowRunError,
  planFlowRetry,
} from '@/lib/flows/retry-policy'

describe('flow retry policy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses defaults and parses valid retry environment overrides', () => {
    expect(getFlowMaxRetryAttempts()).toBe(5)
    expect(getFlowRetryBackoffMs()).toEqual([60_000, 120_000, 300_000, 600_000, 900_000])

    vi.stubEnv('ARCHE_FLOW_RETRY_MAX_ATTEMPTS', '3')
    vi.stubEnv('ARCHE_FLOW_RETRY_BACKOFF_MS', '1000, 2000,3000')

    expect(getFlowMaxRetryAttempts()).toBe(3)
    expect(getFlowRetryBackoffMs()).toEqual([1000, 2000, 3000])
  })

  it('falls back from invalid retry environment values and warns once per raw value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.stubEnv('ARCHE_FLOW_RETRY_MAX_ATTEMPTS', '0')
    vi.stubEnv('ARCHE_FLOW_RETRY_BACKOFF_MS', 'bad, 500, , -1')

    expect(getFlowMaxRetryAttempts()).toBe(5)
    expect(getFlowRetryBackoffMs()).toEqual([500])
    expect(getFlowRetryBackoffMs()).toEqual([500])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[flows] Invalid retry backoff configuration entries ignored',
      expect.objectContaining({ invalidValues: ['bad', '', '-1'] }),
    )

    vi.stubEnv('ARCHE_FLOW_RETRY_BACKOFF_MS', 'none')
    expect(getFlowRetryBackoffMs()).toEqual([60_000, 120_000, 300_000, 600_000, 900_000])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('classifies retryable infrastructure errors', () => {
    expect(isRetryableFlowRunError('healthcheck timeout while starting')).toBe(true)
    expect(isRetryableFlowRunError('INSTANCE_UNAVAILABLE')).toBe(true)
    expect(isRetryableFlowRunError('flow_mcp_connector_unavailable:Mixpanel')).toBe(true)
    expect(isRetryableFlowRunError('fetch failed: ECONNREFUSED')).toBe(true)
    expect(isRetryableFlowRunError('UND_ERR_CONNECT_TIMEOUT')).toBe(true)
    expect(isRetryableFlowRunError('container name /arche is already in use')).toBe(true)
    expect(isRetryableFlowRunError('validation_failed')).toBe(false)
  })

  it('plans retries, exhaustion, non-retryable errors, and capped backoff', () => {
    const now = new Date('2026-05-12T10:00:00.000Z')

    vi.stubEnv('ARCHE_FLOW_RETRY_MAX_ATTEMPTS', '5')
    vi.stubEnv('ARCHE_FLOW_RETRY_BACKOFF_MS', '10,20')

    expect(planFlowRetry({ attempt: 1, error: 'instance_unavailable', now })).toEqual({
      maxAttempts: 5,
      nextAttempt: 2,
      ok: true,
      retryAt: new Date('2026-05-12T10:00:00.010Z'),
    })
    expect(planFlowRetry({ attempt: 2, error: 'flow_mcp_connector_unavailable:Mixpanel', now })).toEqual({
      maxAttempts: 5,
      nextAttempt: 3,
      ok: true,
      retryAt: new Date('2026-05-12T10:00:00.020Z'),
    })
    expect(planFlowRetry({ attempt: 4, error: 'kb_unavailable', now })).toEqual({
      maxAttempts: 5,
      nextAttempt: 5,
      ok: true,
      retryAt: new Date('2026-05-12T10:00:00.020Z'),
    })
    expect(planFlowRetry({ attempt: 5, error: 'user_data_unavailable', now })).toEqual({
      maxAttempts: 5,
      ok: false,
      reason: 'retry_exhausted',
    })
    expect(planFlowRetry({ attempt: 1, error: 'validation_failed', now })).toEqual({
      maxAttempts: 5,
      ok: false,
      reason: 'non_retryable_error',
    })
  })
})
