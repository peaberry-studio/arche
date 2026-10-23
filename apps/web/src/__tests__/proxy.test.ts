import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalNodeEnv = process.env.NODE_ENV
const mocks = vi.hoisted(() => ({ isKnownServerAction: vi.fn<() => boolean | null>(() => true) }))
vi.mock('@/lib/server-action-manifest', () => ({ isKnownServerAction: mocks.isKnownServerAction }))

function getNonceFromCsp(contentSecurityPolicy: string): string {
  const nonceMatch = contentSecurityPolicy.match(/script-src 'self' 'nonce-([^']+)' 'strict-dynamic'/)

  if (!nonceMatch) {
    throw new Error(`Unable to extract nonce from CSP: ${contentSecurityPolicy}`)
  }

  return nonceMatch[1]
}

describe('proxy security headers', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.isKnownServerAction.mockReturnValue(true)
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
      return
    }

    process.env.NODE_ENV = originalNodeEnv
  })

  it('sets nonce-based CSP and security headers for production requests', async () => {
    process.env.NODE_ENV = 'production'
    const { proxy } = await import('@/proxy')

    const request = new NextRequest('https://arche.example.com/u/alice')
    const response = proxy(request)

    const contentSecurityPolicy = response.headers.get('Content-Security-Policy')
    expect(contentSecurityPolicy).toBeTruthy()

    if (!contentSecurityPolicy) {
      throw new Error('Missing Content-Security-Policy header')
    }

    const nonce = getNonceFromCsp(contentSecurityPolicy)

    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    )
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains'
    )

    expect(contentSecurityPolicy).toContain("default-src 'self'")
    expect(contentSecurityPolicy).toContain("object-src 'none'")
    expect(contentSecurityPolicy).toContain("script-src 'self' 'nonce-")
    expect(contentSecurityPolicy).toContain("'strict-dynamic'")
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'")

    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(
      contentSecurityPolicy
    )

    const overrideHeaders = response.headers.get('x-middleware-override-headers')
    expect(overrideHeaders).toContain('x-nonce')
    expect(overrideHeaders).toContain('content-security-policy')
  })

  it('adds unsafe-eval only in development and does not set HSTS', async () => {
    process.env.NODE_ENV = 'development'
    const { proxy } = await import('@/proxy')

    const request = new NextRequest('http://localhost:3000/u/alice')
    const response = proxy(request)

    const contentSecurityPolicy = response.headers.get('Content-Security-Policy')
    expect(contentSecurityPolicy).toContain("'unsafe-eval'")
    expect(response.headers.get('Strict-Transport-Security')).toBeNull()
  })

  it('reloads a cached client whose action was removed by a deployment without executing its POST', async () => {
    process.env.NODE_ENV = 'production'
    mocks.isKnownServerAction.mockReturnValue(false)
    const { proxy } = await import('@/proxy')
    const response = proxy(new NextRequest('https://arche.example.com/u/alice?session=s1', {
      method: 'POST', headers: { 'next-action': 'old-build-action' }, body: 'stale action arguments',
    }))
    expect(response.headers.get('x-action-redirect')).toBe('/u/alice?session=s1;replace')
    expect(response.headers.get('x-middleware-next')).toBeNull()
    expect(response.headers.get('x-nextjs-action-not-found')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([true, null])('preserves action execution when its manifest lookup returns %s', async (known) => {
    process.env.NODE_ENV = 'production'
    mocks.isKnownServerAction.mockReturnValue(known)
    const { proxy } = await import('@/proxy')
    const response = proxy(new NextRequest('https://arche.example.com/u/alice', {
      method: 'POST', headers: { 'next-action': 'current-action' },
    }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-action-redirect')).toBeNull()
  })

  it('skips proxy for prefetch requests using matcher missing rules', async () => {
    const { config } = await import('@/proxy')

    expect(config.matcher).toEqual([
      {
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        missing: [
          { type: 'header', key: 'next-router-prefetch' },
          { type: 'header', key: 'purpose', value: 'prefetch' },
        ],
      },
    ])
  })
})
