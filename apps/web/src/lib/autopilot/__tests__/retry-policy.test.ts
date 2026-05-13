import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAutopilotMaxStartRetries,
  getAutopilotRetryBackoffMs,
  isRetryableAutopilotStartError,
  planAutopilotRetry,
} from '@/lib/autopilot/retry-policy'

describe('autopilot retry policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('classifies transient pre-prompt infrastructure failures as retryable', () => {
    expect(isRetryableAutopilotStartError('healthcheck timeout')).toBe(true)
    expect(isRetryableAutopilotStartError('instance_unavailable')).toBe(true)
    expect(isRetryableAutopilotStartError('fetch failed: ENOTFOUND')).toBe(true)
    expect(isRetryableAutopilotStartError('kb_unavailable')).toBe(true)
    expect(isRetryableAutopilotStartError('user_data_unavailable')).toBe(true)
    expect(isRetryableAutopilotStartError('container name is already in use')).toBe(true)
  })

  it('does not classify functional autopilot failures as retryable start errors', () => {
    expect(isRetryableAutopilotStartError('provider_auth_missing')).toBe(false)
    expect(isRetryableAutopilotStartError('autopilot_no_assistant_message')).toBe(false)
    expect(isRetryableAutopilotStartError('autopilot_run_timeout')).toBe(false)
  })

  it('uses configured max retries and backoffs', () => {
    vi.stubEnv('ARCHE_AUTOPILOT_MAX_START_RETRIES', '2')
    vi.stubEnv('ARCHE_AUTOPILOT_RETRY_BACKOFF_MS', '1000,5000')

    expect(getAutopilotMaxStartRetries()).toBe(2)
    expect(getAutopilotRetryBackoffMs()).toEqual([1000, 5000])

    expect(planAutopilotRetry({
      error: 'healthcheck timeout',
      now: new Date('2026-04-12T09:00:00.000Z'),
      promptSent: false,
      retryAttempt: 1,
      trigger: 'schedule',
    })).toEqual({
      ok: true,
      maxAttempts: 3,
      maxRetries: 2,
      nextRetryAttempt: 2,
      retryAt: new Date('2026-04-12T09:00:05.000Z'),
    })
  })

  it('warns when configured backoffs contain invalid entries', () => {
    vi.stubEnv('ARCHE_AUTOPILOT_RETRY_BACKOFF_MS', '1000, nope, -1')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(getAutopilotRetryBackoffMs()).toEqual([1000])
    expect(warnSpy).toHaveBeenCalledWith('[autopilot] Invalid retry backoff configuration entries ignored', {
      env: 'ARCHE_AUTOPILOT_RETRY_BACKOFF_MS',
      invalidValues: ['nope', '-1'],
      value: '1000, nope, -1',
    })
  })

  it('falls back to default backoffs when every configured entry is invalid', () => {
    vi.stubEnv('ARCHE_AUTOPILOT_RETRY_BACKOFF_MS', 'nope,0')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(getAutopilotRetryBackoffMs()).toEqual([120_000, 300_000, 900_000])
  })

  it('rejects retries for manual, post-prompt, non-retryable, and exhausted failures', () => {
    const now = new Date('2026-04-12T09:00:00.000Z')

    expect(planAutopilotRetry({
      error: 'healthcheck timeout',
      now,
      promptSent: false,
      retryAttempt: 0,
      trigger: 'manual',
    })).toMatchObject({ ok: false, reason: 'trigger_not_retryable' })

    expect(planAutopilotRetry({
      error: 'healthcheck timeout',
      now,
      promptSent: true,
      retryAttempt: 0,
      trigger: 'schedule',
    })).toMatchObject({ ok: false, reason: 'post_prompt_failure' })

    expect(planAutopilotRetry({
      error: 'provider_auth_missing',
      now,
      promptSent: false,
      retryAttempt: 0,
      trigger: 'schedule',
    })).toMatchObject({ ok: false, reason: 'non_retryable_error' })

    expect(planAutopilotRetry({
      error: 'healthcheck timeout',
      now,
      promptSent: false,
      retryAttempt: 3,
      trigger: 'schedule',
    })).toMatchObject({ ok: false, reason: 'retry_exhausted' })
  })
})
