import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getGatewayTokenSecret,
  getGatewayTokenTtlSeconds,
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
})
