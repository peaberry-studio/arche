import { describe, expect, it } from 'vitest'

import {
  formatConnectorErrorCode,
  getConnectorErrorMessage,
} from '@/components/connectors/error-messages'

describe('connector error messages', () => {
  it('maps known connector error codes to user-facing messages', () => {
    expect(formatConnectorErrorCode('unauthorized', 'network_error')).toBe(
      'Your session has expired. Please sign in again.',
    )
    expect(formatConnectorErrorCode('oauth_exchange_failed:invalid_grant', 'network_error')).toBe(
      'OAuth token exchange failed. Please retry.',
    )
  })

  it('humanizes unknown code-shaped errors and preserves non-code messages', () => {
    expect(formatConnectorErrorCode('custom_error_code', 'network_error')).toBe('Custom error code')
    expect(formatConnectorErrorCode('Provider said no.', 'network_error')).toBe('Provider said no.')
  })

  it('uses fallback codes when raw codes are blank', () => {
    expect(formatConnectorErrorCode('   ', 'network_error')).toBe('Network error. Please try again.')
    expect(formatConnectorErrorCode('', '')).toBe('Request failed.')
  })

  it('reads message before error from connector error payloads', () => {
    expect(getConnectorErrorMessage({ message: 'blocked_endpoint', error: 'network_error' }, 'save_failed')).toBe(
      'Connector endpoint is blocked for security reasons.',
    )
    expect(getConnectorErrorMessage({ error: 'save_failed' }, 'network_error')).toBe(
      'Failed to save connector changes.',
    )
  })

  it('falls back for primitive or incomplete payloads', () => {
    expect(getConnectorErrorMessage(null, 'test_failed')).toBe('Connection test failed.')
    expect(getConnectorErrorMessage('network_error', 'network_error')).toBe('Network error. Please try again.')
    expect(getConnectorErrorMessage({}, 'missing_endpoint')).toBe('Connector endpoint is required.')
  })
})
