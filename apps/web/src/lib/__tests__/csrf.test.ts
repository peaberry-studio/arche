import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('csrf validateSameOrigin', () => {
  beforeEach(() => {
    vi.resetModules()
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

  it('returns ok=false when Origin host does not match Host', async () => {
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

  it('returns ok=true when Origin host matches Host', async () => {
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
