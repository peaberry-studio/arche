import { describe, it, expect } from 'vitest'
import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { CONNECTOR_TYPES } from '@/lib/connectors/types'
import {
  validateConnectorType,
  validateConnectorConfig,
  validateConnectorName,
  CONNECTOR_SCHEMAS,
  MAX_CONNECTOR_NAME_LENGTH,
} from '@/lib/connectors/validators'

describe('connectors/crypto', () => {
  const sample = { apiKey: 'sk-123', workspace: 'my-team' }

  it('encryptConfig produces iv:tag:data format', () => {
    const encrypted = encryptConfig(sample)
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
  })

  it('decryptConfig round-trips correctly', () => {
    const encrypted = encryptConfig(sample)
    const decrypted = decryptConfig(encrypted)
    expect(decrypted).toEqual(sample)
  })

  it('decryptConfig throws on corrupted input', () => {
    expect(() => decryptConfig('bad:data:here')).toThrow('Failed to decrypt connector configuration')
  })

  it('round-trips empty config', () => {
    const encrypted = encryptConfig({})
    expect(decryptConfig(encrypted)).toEqual({})
  })

  it('round-trips unicode values', () => {
    const config = { name: '日本語テスト', emoji: '🚀', accent: 'café' }
    const encrypted = encryptConfig(config)
    expect(decryptConfig(encrypted)).toEqual(config)
  })

  it('rejects config exceeding max size', () => {
    const big = { data: 'x'.repeat(11 * 1024) }
    expect(() => encryptConfig(big)).toThrow('exceeds maximum size')
  })
})

describe('connectors/types', () => {
  it('CONNECTOR_TYPES contains expected values', () => {
    expect(CONNECTOR_TYPES).toEqual(['linear', 'notion', 'custom'])
  })
})

describe('connectors/validators', () => {
  describe('validateConnectorType', () => {
    it('accepts valid connector types', () => {
      expect(validateConnectorType('linear')).toBe(true)
      expect(validateConnectorType('notion')).toBe(true)
      expect(validateConnectorType('custom')).toBe(true)
    })

    it('rejects invalid connector types', () => {
      expect(validateConnectorType('invalid')).toBe(false)
      expect(validateConnectorType('')).toBe(false)
      expect(validateConnectorType('LINEAR')).toBe(false)
    })
  })

  describe('validateConnectorConfig', () => {
    it('validates required fields for linear', () => {
      const valid = validateConnectorConfig('linear', { apiKey: 'key123' })
      expect(valid).toEqual({ valid: true })

      const invalid = validateConnectorConfig('linear', {})
      expect(invalid.valid).toBe(false)
      expect(invalid.missing).toContain('apiKey')
    })

    it('validates required fields for notion', () => {
      const valid = validateConnectorConfig('notion', { apiKey: 'secret_xxx' })
      expect(valid).toEqual({ valid: true })

      const invalid = validateConnectorConfig('notion', {})
      expect(invalid.valid).toBe(false)
      expect(invalid.missing).toContain('apiKey')
    })

    it('validates required fields for custom', () => {
      const valid = validateConnectorConfig('custom', { endpoint: 'https://api.example.com' })
      expect(valid).toEqual({ valid: true })

      const invalid = validateConnectorConfig('custom', {})
      expect(invalid.valid).toBe(false)
      expect(invalid.missing).toContain('endpoint')
    })

    it('validates oauth mode for custom connectors', () => {
      expect(validateConnectorConfig('custom', { authType: 'oauth', endpoint: 'https://api.example.com/mcp' })).toEqual({
        valid: true,
      })

      expect(validateConnectorConfig('custom', { authType: 'oauth' })).toEqual({
        valid: false,
        missing: ['endpoint'],
      })
    })

    it('reports multiple missing fields', () => {
      // custom requires endpoint, but we also check behavior with empty object
      const result = validateConnectorConfig('custom', {})
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['endpoint'])
    })

    it('rejects empty string values for required fields', () => {
      const emptyString = validateConnectorConfig('linear', { apiKey: '' })
      expect(emptyString.valid).toBe(false)
      expect(emptyString.missing).toContain('apiKey')

      const whitespace = validateConnectorConfig('linear', { apiKey: '   ' })
      expect(whitespace.valid).toBe(false)
      expect(whitespace.missing).toContain('apiKey')
    })

    it('rejects null/undefined values for required fields', () => {
      const nullValue = validateConnectorConfig('linear', { apiKey: null })
      expect(nullValue.valid).toBe(false)

      const undefinedValue = validateConnectorConfig('linear', { apiKey: undefined })
      expect(undefinedValue.valid).toBe(false)
    })
  })

  describe('validateConnectorName', () => {
    it('accepts valid names', () => {
      expect(validateConnectorName('My Connector')).toEqual({ valid: true })
      expect(validateConnectorName('a')).toEqual({ valid: true })
      expect(validateConnectorName('Linear Integration')).toEqual({ valid: true })
    })

    it('rejects non-string values', () => {
      expect(validateConnectorName(123).valid).toBe(false)
      expect(validateConnectorName(null).valid).toBe(false)
      expect(validateConnectorName(undefined).valid).toBe(false)
      expect(validateConnectorName({}).valid).toBe(false)
    })

    it('rejects empty or whitespace-only names', () => {
      expect(validateConnectorName('').valid).toBe(false)
      expect(validateConnectorName('   ').valid).toBe(false)
      expect(validateConnectorName('\t\n').valid).toBe(false)
    })

    it('rejects names exceeding max length', () => {
      const tooLong = 'a'.repeat(MAX_CONNECTOR_NAME_LENGTH + 1)
      const result = validateConnectorName(tooLong)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('maximum length')

      // Exactly at limit should be valid
      const atLimit = 'a'.repeat(MAX_CONNECTOR_NAME_LENGTH)
      expect(validateConnectorName(atLimit)).toEqual({ valid: true })
    })

    it('trims whitespace for length validation', () => {
      // Name with leading/trailing whitespace should be valid if trimmed length is within limit
      const withWhitespace = '  Valid Name  '
      expect(validateConnectorName(withWhitespace)).toEqual({ valid: true })
    })
  })

  describe('CONNECTOR_SCHEMAS', () => {
    it('has schema for all connector types', () => {
      for (const type of CONNECTOR_TYPES) {
        expect(CONNECTOR_SCHEMAS[type]).toBeDefined()
        expect(CONNECTOR_SCHEMAS[type].required).toBeDefined()
        expect(Array.isArray(CONNECTOR_SCHEMAS[type].required)).toBe(true)
      }
    })
  })
})
