import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetGatewayTokenSecret = vi.hoisted(() => vi.fn())
const mockGetGatewayTokenTtlSeconds = vi.hoisted(() => vi.fn())

vi.mock('@/lib/providers/config', () => ({
  getGatewayTokenSecret: (...args: unknown[]) => mockGetGatewayTokenSecret(...args),
  getGatewayTokenTtlSeconds: (...args: unknown[]) => mockGetGatewayTokenTtlSeconds(...args),
}))

import { issueGatewayToken, verifyGatewayToken, type GatewayTokenInput } from '../tokens'

describe('tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    mockGetGatewayTokenSecret.mockReturnValue('test-secret')
    mockGetGatewayTokenTtlSeconds.mockReturnValue(900)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('issueGatewayToken', () => {
    it('creates a token with encoded payload and signature', () => {
      const input: GatewayTokenInput = {
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      }

      const token = issueGatewayToken(input)
      const parts = token.split('.')

      expect(parts).toHaveLength(2)
      expect(parts[0]).toBeTruthy()
      expect(parts[1]).toBeTruthy()
    })

    it('sets exp based on current time and ttl', () => {
      const input: GatewayTokenInput = {
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      }

      mockGetGatewayTokenTtlSeconds.mockReturnValue(300)
      const token = issueGatewayToken(input)
      const [encoded] = token.split('.')
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))

      expect(payload.exp).toBe(1704067200 + 300)
    })
  })

  describe('verifyGatewayToken', () => {
    it('returns payload for a valid token', () => {
      const input: GatewayTokenInput = {
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      }

      const token = issueGatewayToken(input)
      const payload = verifyGatewayToken(token)

      expect(payload).toMatchObject({
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      })
      expect(payload.exp).toBeTypeOf('number')
    })

    it('throws invalid_token for malformed token', () => {
      expect(() => verifyGatewayToken('not-a-token')).toThrow('invalid_token')
      expect(() => verifyGatewayToken('only-one-part')).toThrow('invalid_token')
      expect(() => verifyGatewayToken('')).toThrow('invalid_token')
    })

    it('throws invalid_token when signature does not match', () => {
      const input: GatewayTokenInput = {
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      }

      const token = issueGatewayToken(input)
      const [encoded] = token.split('.')
      const tamperedToken = `${encoded}.tamperedsignature`

      expect(() => verifyGatewayToken(tamperedToken)).toThrow('invalid_token')
    })

    it('throws token_expired when token has expired', () => {
      const input: GatewayTokenInput = {
        userId: 'u1',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
      }

      // Issue token with 1 second TTL
      mockGetGatewayTokenTtlSeconds.mockReturnValue(1)
      const token = issueGatewayToken(input)

      // Advance time past expiration
      vi.advanceTimersByTime(2000)

      expect(() => verifyGatewayToken(token)).toThrow('token_expired')
    })

    it('throws invalid_token for payload with invalid fields', () => {
      // Create a valid encoding but with invalid payload structure
      const encoded = Buffer.from(JSON.stringify({
        userId: '',
        workspaceSlug: 'ws1',
        providerId: 'openai',
        version: 1,
        exp: 9999999999,
      })).toString('base64url')
      const signature = 'Y62BTh0QJzRcqGfyT4L5TQkZRImMTkvs5Jr3ifEcJ_k'
      const token = `${encoded}.${signature}`

      expect(() => verifyGatewayToken(token)).toThrow('invalid_token')
    })

    it('throws invalid_token when token has empty parts', () => {
      expect(() => verifyGatewayToken('.')).toThrow('invalid_token')
      expect(() => verifyGatewayToken('encoded.')).toThrow('invalid_token')
      expect(() => verifyGatewayToken('.signature')).toThrow('invalid_token')
    })
  })
})
