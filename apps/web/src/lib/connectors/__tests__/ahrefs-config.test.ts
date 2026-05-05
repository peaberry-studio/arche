import { describe, expect, it } from 'vitest'

import { parseAhrefsConnectorConfig, validateAhrefsConnectorConfig } from '@/lib/connectors/ahrefs-config'

describe('ahrefs-config', () => {
  describe('parseAhrefsConnectorConfig', () => {
    it('parses valid config', () => {
      const result = parseAhrefsConnectorConfig({ apiKey: 'my-api-key' })
      expect(result).toEqual({ ok: true, value: { apiKey: 'my-api-key' } })
    })

    it('trims the apiKey', () => {
      const result = parseAhrefsConnectorConfig({ apiKey: '  my-api-key  ' })
      expect(result).toEqual({ ok: true, value: { apiKey: 'my-api-key' } })
    })

    it('returns missing fields when apiKey is empty', () => {
      const result = parseAhrefsConnectorConfig({ apiKey: '' })
      expect(result).toEqual({ ok: false, missing: ['apiKey'] })
    })

    it('returns missing fields when apiKey is not a string', () => {
      const result = parseAhrefsConnectorConfig({ apiKey: 123 })
      expect(result).toEqual({ ok: false, missing: ['apiKey'] })
    })

    it('returns missing fields when apiKey is missing', () => {
      const result = parseAhrefsConnectorConfig({})
      expect(result).toEqual({ ok: false, missing: ['apiKey'] })
    })
  })

  describe('validateAhrefsConnectorConfig', () => {
    it('returns valid for correct config', () => {
      const result = validateAhrefsConnectorConfig({ apiKey: 'key' })
      expect(result).toEqual({ valid: true })
    })

    it('returns invalid for missing apiKey', () => {
      const result = validateAhrefsConnectorConfig({})
      expect(result).toEqual({ valid: false, missing: ['apiKey'] })
    })
  })
})
