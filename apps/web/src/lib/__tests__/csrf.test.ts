import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalPublicBaseUrl = process.env.ARCHE_PUBLIC_BASE_URL
const originalRuntimeMode = process.env.ARCHE_RUNTIME_MODE

describe('csrf validateSameOrigin', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.ARCHE_PUBLIC_BASE_URL
    delete process.env.ARCHE_RUNTIME_MODE
  })

  afterEach(() => {
    if (originalPublicBaseUrl === undefined) {
      delete process.env.ARCHE_PUBLIC_BASE_URL
    } else {
      process.env.ARCHE_PUBLIC_BASE_URL = originalPublicBaseUrl
    }

    if (originalRuntimeMode === undefined) {
      delete process.env.ARCHE_RUNTIME_MODE
    } else {
      process.env.ARCHE_RUNTIME_MODE = originalRuntimeMode
    }
  })

  it('returns ok=false when Origin is missing regardless of runtime mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://127.0.0.1:3000/api/w/local/chat/stream', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
      },
    })

    // validateSameOrigin always validates; callers (withAuth) gate on caps.csrf
    expect(validateSameOrigin(request)).toEqual({ ok: false })
  })

  it('returns ok=false when Origin is missing', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://localhost/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'localhost',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: false })
  })

  it('returns ok=false when Origin is null', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://localhost/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'null',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: false })
  })

  it('returns ok=false when Origin host does not match expected origin', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://localhost/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://evil.test',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: false })
  })

  it('returns ok=false when Origin scheme does not match expected origin', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('https://arche.example.com/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'arche.example.com',
        origin: 'http://arche.example.com',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: false })
  })

  it('returns ok=true when forwarded host and proto match Origin', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://internal:3000/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'internal:3000',
        'x-forwarded-host': 'arche.example.com',
        'x-forwarded-proto': 'https',
        origin: 'https://arche.example.com',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: true })
  })

  it('ignores bind-address ARCHE_PUBLIC_BASE_URL and uses request origin fallback', async () => {
    process.env.ARCHE_PUBLIC_BASE_URL = 'http://0.0.0.0:3000'
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://localhost/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: true })
  })

  it('returns ok=true when Origin matches expected origin', async () => {
    const { validateSameOrigin } = await import('@/lib/csrf')

    const request = new Request('http://localhost/api/u/alice/connectors', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
      },
    })

    expect(validateSameOrigin(request)).toEqual({ ok: true })
  })
})
