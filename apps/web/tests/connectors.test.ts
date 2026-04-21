import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import {
  DEFAULT_META_ADS_CONNECTOR_PERMISSIONS,
} from '@/lib/connectors/meta-ads-types'
import {
  parseMetaAdsConnectorConfig,
  parseMetaAdsConnectorPermissions,
} from '@/lib/connectors/meta-ads'
import { CONNECTOR_TYPES } from '@/lib/connectors/types'
import {
  parseZendeskConnectorConfig,
  parseZendeskConnectorPermissions,
} from '@/lib/connectors/zendesk'
import { DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS } from '@/lib/connectors/zendesk-types'
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
    expect(CONNECTOR_TYPES).toEqual(['linear', 'notion', 'zendesk', 'custom', 'meta-ads'])
  })
})

describe('connectors/availability', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('keeps Meta Ads available in web runtime', async () => {
    delete process.env.ARCHE_RUNTIME_MODE

    const {
      getAvailableConnectorTypes,
      getConnectorTypeAvailabilityMessage,
      isConnectorTypeAvailable,
    } = await import('@/lib/connectors/availability')

    expect(isConnectorTypeAvailable('meta-ads')).toBe(true)
    expect(getConnectorTypeAvailabilityMessage('meta-ads')).toBeNull()
    expect(getAvailableConnectorTypes()).toContain('meta-ads')
  })

  it('hides Meta Ads in desktop runtime and exposes a consistent error message', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const {
      getAvailableConnectorTypes,
      getConnectorTypeAvailabilityMessage,
      isConnectorTypeAvailable,
    } = await import('@/lib/connectors/availability')
    const { requireAvailableConnectorType } = await import('@/lib/connectors/availability-response')

    expect(isConnectorTypeAvailable('meta-ads')).toBe(false)
    expect(getAvailableConnectorTypes()).not.toContain('meta-ads')
    expect(getConnectorTypeAvailabilityMessage('meta-ads')).toBe(
      'Meta Ads connectors are only available in the VPS runtime.'
    )

    const response = requireAvailableConnectorType('meta-ads')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
    await expect(response!.json()).resolves.toEqual({
      error: 'connector_not_available',
      message: 'Meta Ads connectors are only available in the VPS runtime.',
    })
  })
})

describe('connectors/validators', () => {
  describe('validateConnectorType', () => {
    it('accepts valid connector types', () => {
      expect(validateConnectorType('linear')).toBe(true)
      expect(validateConnectorType('notion')).toBe(true)
      expect(validateConnectorType('zendesk')).toBe(true)
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

    it('validates required fields for zendesk', () => {
      const valid = validateConnectorConfig('zendesk', {
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
      })
      expect(valid).toEqual({ valid: true })

      const invalid = validateConnectorConfig('zendesk', {})
      expect(invalid.valid).toBe(false)
      expect(invalid.missing).toEqual(['subdomain', 'email', 'apiToken'])
    })

    it('validates required fields for meta-ads', () => {
      const valid = validateConnectorConfig('meta-ads', {
        authType: 'oauth',
        appId: 'app-123',
        appSecret: 'secret-123',
      })
      expect(valid).toEqual({ valid: true })

      const invalid = validateConnectorConfig('meta-ads', { authType: 'oauth' })
      expect(invalid.valid).toBe(false)
      expect(invalid.missing).toEqual(['appId', 'appSecret'])
    })

    it('rejects manual mode for meta-ads connectors', () => {
      expect(validateConnectorConfig('meta-ads', {
        authType: 'manual',
        appId: 'app-123',
        appSecret: 'secret-123',
      })).toEqual({
        valid: false,
        message: 'Meta Ads connectors require OAuth',
      })
    })

    it('rejects invalid zendesk subdomains', () => {
      const invalid = validateConnectorConfig('zendesk', {
        subdomain: 'https://127.0.0.1/private',
        email: 'agent@example.com',
        apiToken: 'token-123',
      })

      expect(invalid).toEqual({
        valid: false,
        message: 'Subdomain must be a valid Zendesk subdomain or hostname.',
      })
    })

    it('rejects oauth mode for zendesk connectors', () => {
      expect(validateConnectorConfig('zendesk', {
        authType: 'oauth',
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
      })).toEqual({
        valid: false,
        message: 'Zendesk connectors do not support OAuth',
      })
    })

    it('accepts Zendesk connectors without explicit permissions for backward compatibility', () => {
      expect(validateConnectorConfig('zendesk', {
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
      })).toEqual({ valid: true })
    })

    it('rejects invalid Zendesk permission values', () => {
      expect(validateConnectorConfig('zendesk', {
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
        permissions: {
          allowRead: 'yes',
        },
      })).toEqual({
        valid: false,
        message: 'allowRead must be a boolean',
      })
    })

    it('rejects Zendesk ticket creation without any allowed comment visibility', () => {
      expect(validateConnectorConfig('zendesk', {
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
        permissions: {
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: false,
          allowInternalComments: false,
        },
      })).toEqual({
        valid: false,
        message: 'Ticket creation requires public comments or internal notes to stay enabled.',
      })
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

describe('connectors/zendesk-config', () => {
  it('defaults missing Zendesk permissions to full access', () => {
    expect(parseZendeskConnectorPermissions(undefined)).toEqual({
      ok: true,
      value: DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
    })
  })

  it('parses partial Zendesk permissions while keeping safe defaults', () => {
    expect(parseZendeskConnectorPermissions({ allowPublicComments: false })).toEqual({
      ok: true,
      value: {
        ...DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
        allowPublicComments: false,
      },
    })
  })

  it('requires all settings fields when asked to parse a settings payload', () => {
    expect(parseZendeskConnectorPermissions({ allowRead: true }, { requireAll: true })).toEqual({
      ok: false,
      message: 'allowCreateTickets is required',
    })
  })

  it('normalizes parsed Zendesk config with default permissions', () => {
    expect(parseZendeskConnectorConfig({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
    })).toEqual({
      ok: true,
      value: {
        subdomain: 'acme',
        email: 'agent@example.com',
        apiToken: 'token-123',
        permissions: DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
      },
    })
  })
})

describe('connectors/meta-ads-config', () => {
  it('defaults missing Meta Ads permissions to read-only', () => {
    expect(parseMetaAdsConnectorPermissions(undefined)).toEqual({
      ok: true,
      value: DEFAULT_META_ADS_CONNECTOR_PERMISSIONS,
    })
  })

  it('normalizes selected ad account ids and validates default account membership', () => {
    expect(parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'app-123',
      appSecret: 'secret-123',
      selectedAdAccountIds: ['123', 'act_456', '123'],
      defaultAdAccountId: '456',
    })).toEqual({
      ok: true,
      value: {
        authType: 'oauth',
        appId: 'app-123',
        appSecret: 'secret-123',
        permissions: DEFAULT_META_ADS_CONNECTOR_PERMISSIONS,
        selectedAdAccountIds: ['act_123', 'act_456'],
        defaultAdAccountId: 'act_456',
      },
    })
  })
})
