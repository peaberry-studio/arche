import { afterEach, describe, expect, it, vi } from 'vitest'

import { firstHeaderValue, getClientIp, getPublicBaseUrl, stripPort } from '../http'

describe('firstHeaderValue', () => {
  it('returns null for empty input', () => {
    expect(firstHeaderValue('')).toBeNull()
    expect(firstHeaderValue(null)).toBeNull()
  })

  it('returns the first comma-separated value trimmed', () => {
    expect(firstHeaderValue('  192.168.1.1, 10.0.0.1  ')).toBe('192.168.1.1')
  })

  it('returns the sole value when no comma is present', () => {
    expect(firstHeaderValue('203.0.113.5')).toBe('203.0.113.5')
  })

  it('returns null when the trimmed segment is empty', () => {
    expect(firstHeaderValue(',,,,')).toBeNull()
  })
})

describe('stripPort', () => {
  it('removes a trailing :port', () => {
    expect(stripPort('example.com:3000')).toBe('example.com')
  })

  it('removes the trailing port from bracketed IPv6', () => {
    expect(stripPort('[::1]:3000')).toBe('[::1]')
  })

  it('strips the last octet-like segment from bare IPv6', () => {
    expect(stripPort('::1')).toBe(':')
  })

  it('returns unchanged when no port is present', () => {
    expect(stripPort('example.com')).toBe('example.com')
  })
})

describe('getClientIp', () => {
  it('prefers x-forwarded-for over x-real-ip', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.1, 192.168.1.1',
      'x-real-ip': '203.0.113.2',
    })
    expect(getClientIp(headers)).toBe('203.0.113.1')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.2' })
    expect(getClientIp(headers)).toBe('203.0.113.2')
  })

  it('returns null when neither header is present', () => {
    expect(getClientIp(new Headers())).toBeNull()
  })
})

describe('getPublicBaseUrl', () => {
  const originalBaseUrl = process.env.ARCHE_PUBLIC_BASE_URL

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.ARCHE_PUBLIC_BASE_URL
    } else {
      process.env.ARCHE_PUBLIC_BASE_URL = originalBaseUrl
    }
  })

  it('uses ARCHE_PUBLIC_BASE_URL when set and valid', () => {
    process.env.ARCHE_PUBLIC_BASE_URL = 'https://app.example.com/'
    const headers = new Headers()
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('https://app.example.com')
  })

  it('ignores ARCHE_PUBLIC_BASE_URL when it is a bind address', () => {
    process.env.ARCHE_PUBLIC_BASE_URL = 'http://0.0.0.0:3000'
    const headers = new Headers()
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('uses x-forwarded-proto and x-forwarded-host when present', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'proxy.example.com',
    })
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('https://proxy.example.com')
  })

  it('uses the host header when x-forwarded-host is absent', () => {
    const headers = new Headers({ host: 'localhost:3000' })
    expect(getPublicBaseUrl(headers, 'http://fallback')).toBe('http://localhost:3000')
  })

  it('skips bind addresses in host headers', () => {
    const headers = new Headers({ host: '0.0.0.0:3000' })
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('skips bind addresses in x-forwarded-host', () => {
    const headers = new Headers({
      'x-forwarded-host': '[::]',
      'x-forwarded-proto': 'https',
    })
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('falls back to fallbackOrigin when other sources are missing', () => {
    const headers = new Headers()
    expect(getPublicBaseUrl(headers, 'http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('derives protocol from fallback origin when x-forwarded-proto is missing', () => {
    const headers = new Headers({ host: 'localhost' })
    expect(getPublicBaseUrl(headers, 'https://localhost:3000')).toBe('https://localhost')
  })

  it('defaults protocol to http when no fallback has a scheme', () => {
    const headers = new Headers({ host: 'localhost' })
    expect(getPublicBaseUrl(headers, 'bad-value')).toBe('http://localhost')
  })
})
