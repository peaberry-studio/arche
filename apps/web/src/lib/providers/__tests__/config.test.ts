import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getGatewayTokenSecret,
  getGatewayTokenTtlSeconds,
  getGatewayBaseUrlForProvider,
} from '../config'

describe('config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getGatewayTokenSecret', () => {
    it('returns the env var when set', () => {
      process.env.ARCHE_GATEWAY_TOKEN_SECRET = 'my-secret'
      expect(getGatewayTokenSecret()).toBe('my-secret')
    })

    it('returns dev default in non-production without env var', () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'development'
      expect(getGatewayTokenSecret()).toBe('dev-insecure-gateway-secret')
    })

    it('throws in production when env var is missing', () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_SECRET
      process.env.NODE_ENV = 'production'
      expect(() => getGatewayTokenSecret()).toThrow('ARCHE_GATEWAY_TOKEN_SECRET is required in production')
    })
  })

  describe('getGatewayTokenTtlSeconds', () => {
    it('returns parsed env var when valid', () => {
      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '3600'
      expect(getGatewayTokenTtlSeconds()).toBe(3600)
    })

    it('returns default 900 when env var is not set', () => {
      delete process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS
      expect(getGatewayTokenTtlSeconds()).toBe(900)
    })

    it('returns default when env var is not a number', () => {
      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = 'not-a-number'
      expect(getGatewayTokenTtlSeconds()).toBe(900)
    })

    it('returns default when env var is zero or negative', () => {
      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '0'
      expect(getGatewayTokenTtlSeconds()).toBe(900)

      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '-1'
      expect(getGatewayTokenTtlSeconds()).toBe(900)
    })

    it('floors fractional values', () => {
      process.env.ARCHE_GATEWAY_TOKEN_TTL_SECONDS = '900.7'
      expect(getGatewayTokenTtlSeconds()).toBe(900)
    })
  })

  describe('getGatewayBaseUrlForProvider', () => {
    it('returns default base URL with provider path', () => {
      delete process.env.ARCHE_GATEWAY_BASE_URL
      expect(getGatewayBaseUrlForProvider('openai')).toBe('http://web:3000/api/internal/providers/openai')
    })

    it('uses custom ARCHE_GATEWAY_BASE_URL', () => {
      process.env.ARCHE_GATEWAY_BASE_URL = 'https://gateway.example.com'
      expect(getGatewayBaseUrlForProvider('anthropic')).toBe('https://gateway.example.com/anthropic')
    })

    it('strips trailing slash from custom base URL', () => {
      process.env.ARCHE_GATEWAY_BASE_URL = 'https://gateway.example.com/'
      expect(getGatewayBaseUrlForProvider('fireworks')).toBe('https://gateway.example.com/fireworks')
    })
  })
})
