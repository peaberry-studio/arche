import { describe, expect, it, vi } from 'vitest'

import { validateConnectorTestEndpoint } from '../ssrf'

describe('validateConnectorTestEndpoint', () => {
  it('rejects empty or whitespace-only endpoints', async () => {
    const lookupHost = vi.fn()
    const r1 = await validateConnectorTestEndpoint('', { lookupHost })
    expect(r1).toEqual({ ok: false, error: 'invalid_endpoint' })

    const r2 = await validateConnectorTestEndpoint('   ', { lookupHost })
    expect(r2).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('rejects endpoints without a protocol', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('api.example.com/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('rejects endpoints with non-https protocols', async () => {
    const lookupHost = vi.fn()
    const r1 = await validateConnectorTestEndpoint('ftp://api.example.com/mcp', { lookupHost })
    expect(r1).toEqual({ ok: false, error: 'invalid_endpoint' })

    const r2 = await validateConnectorTestEndpoint('http://api.example.com/mcp', { lookupHost })
    expect(r2).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('rejects empty hostname after bracket normalization', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://[]/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('rejects subdomains ending with .localhost', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://app.localhost/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('rejects private ipv4 subnets other than 127', async () => {
    const lookupHost = vi.fn()
    const tests = [
      'https://10.0.0.1/mcp',
      'https://172.16.0.1/mcp',
      'https://192.168.1.1/mcp',
      'https://169.254.1.1/mcp',
      'https://0.0.0.0/mcp',
      'https://0.1.2.3/mcp',
    ]

    for (const url of tests) {
      const result = await validateConnectorTestEndpoint(url, { lookupHost })
      expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
    }
  })

  it('rejects ipv6 unicast local and link-local addresses', async () => {
    const lookupHost = vi.fn()
    const tests = [
      'https://[fc00::1]/mcp',
      'https://[fe80::1]/mcp',
      'https://[fd00::1234]/mcp',
    ]

    for (const url of tests) {
      const result = await validateConnectorTestEndpoint(url, { lookupHost })
      expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
    }
  })

  it('rejects ipv4-mapped ipv6 dotted notation for localhost', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://[::ffff:127.0.0.1]/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
  })

  it('rejects ipv4-mapped ipv6 hexadecimal notation for private addresses', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://[::ffff:0a00:0001]/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
  })

  it('rejects hostnames that resolve to private addresses via dns', async () => {
    const lookupHost = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])

    const result = await validateConnectorTestEndpoint('https://mixed.example/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
  })

  it('rejects hostnames that resolve to hexadecimal ipv4-mapped ipv6 private addresses', async () => {
    const lookupHost = vi.fn().mockResolvedValue([
      { address: '::ffff:0a00:0001', family: 6 },
    ])

    const result = await validateConnectorTestEndpoint('https://mapped.example/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'blocked_endpoint' })
  })

  it('rejects hostnames with empty dns responses', async () => {
    const lookupHost = vi.fn().mockResolvedValue([])
    const result = await validateConnectorTestEndpoint('https://empty.example/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('rejects hostnames with non-array dns responses', async () => {
    const lookupHost = vi.fn().mockResolvedValue(null)
    const result = await validateConnectorTestEndpoint('https://null.example/mcp', { lookupHost })
    expect(result).toEqual({ ok: false, error: 'invalid_endpoint' })
  })

  it('accepts public ipv4 literals without dns lookup', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://8.8.8.8/mcp', { lookupHost })
    expect(result.ok).toBe(true)
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('accepts public ipv6 literals without dns lookup', async () => {
    const lookupHost = vi.fn()
    const result = await validateConnectorTestEndpoint('https://[2001:4860:4860::8888]/mcp', { lookupHost })
    expect(result.ok).toBe(true)
    expect(lookupHost).not.toHaveBeenCalled()
  })

  it('accepts public hostnames after successful dns', async () => {
    const lookupHost = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])

    const result = await validateConnectorTestEndpoint('https://api.example.com/mcp', { lookupHost })
    expect(result.ok).toBe(true)
    expect(lookupHost).toHaveBeenCalledWith('api.example.com')
  })

  it('uses the default dns lookup when no custom lookup is provided', async () => {
    vi.resetModules()
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    vi.doMock('node:dns/promises', () => ({ lookup }))

    const { validateConnectorTestEndpoint: validateWithDefaultLookup } = await import('../ssrf')

    const result = await validateWithDefaultLookup('https://default-lookup.example/mcp')

    expect(result.ok).toBe(true)
    expect(lookup).toHaveBeenCalledWith('default-lookup.example', { all: true, verbatim: true })
    vi.doUnmock('node:dns/promises')
  })
})
