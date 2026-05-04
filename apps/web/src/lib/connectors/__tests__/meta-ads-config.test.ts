import { describe, expect, it } from 'vitest'

import {
  isMetaAdsConnectorReady,
  normalizeMetaAdsAccountId,
  parseMetaAdsConnectorConfig,
  parseMetaAdsConnectorPermissions,
  parseMetaAdsSelectedAdAccountIds,
  validateMetaAdsConnectorConfig,
} from '@/lib/connectors/meta-ads-config'

describe('normalizeMetaAdsAccountId', () => {
  it('returns null for empty or whitespace-only strings', () => {
    expect(normalizeMetaAdsAccountId('')).toBeNull()
    expect(normalizeMetaAdsAccountId('   ')).toBeNull()
  })

  it('preserves act_ prefixed IDs', () => {
    expect(normalizeMetaAdsAccountId('act_123456789')).toBe('act_123456789')
    expect(normalizeMetaAdsAccountId('act_999')).toBe('act_999')
  })

  it('adds act_ prefix to numeric strings', () => {
    expect(normalizeMetaAdsAccountId('123456789')).toBe('act_123456789')
    expect(normalizeMetaAdsAccountId('42')).toBe('act_42')
  })

  it('trims whitespace before normalizing', () => {
    expect(normalizeMetaAdsAccountId('  123  ')).toBe('act_123')
    expect(normalizeMetaAdsAccountId('  act_456  ')).toBe('act_456')
  })

  it('returns null for invalid formats', () => {
    expect(normalizeMetaAdsAccountId('not_a_number')).toBeNull()
    expect(normalizeMetaAdsAccountId('act_')).toBeNull()
    expect(normalizeMetaAdsAccountId('act_abc')).toBeNull()
    expect(normalizeMetaAdsAccountId('123abc')).toBeNull()
    expect(normalizeMetaAdsAccountId('-5')).toBeNull()
  })
})

describe('parseMetaAdsConnectorPermissions', () => {
  it('returns defaults when value is undefined', () => {
    const result = parseMetaAdsConnectorPermissions(undefined)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.allowRead).toBe(true)
    expect(result.value.allowWriteCampaigns).toBe(false)
  })

  it('requires all permissions when requireAll is true', () => {
    const result = parseMetaAdsConnectorPermissions(undefined, { requireAll: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('permissions is required')
  })

  it('rejects non-object values', () => {
    expect(parseMetaAdsConnectorPermissions('string', { requireAll: true }).ok).toBe(false)
    expect(parseMetaAdsConnectorPermissions(42, { requireAll: true }).ok).toBe(false)
    expect(parseMetaAdsConnectorPermissions(null, { requireAll: true }).ok).toBe(false)
  })

  it('parses valid permissions object', () => {
    const result = parseMetaAdsConnectorPermissions({
      allowRead: true,
      allowWriteCampaigns: true,
      allowWriteAdSets: false,
      allowWriteAds: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.allowRead).toBe(true)
    expect(result.value.allowWriteCampaigns).toBe(true)
    expect(result.value.allowWriteAdSets).toBe(false)
    expect(result.value.allowWriteAds).toBe(false)
  })

  it('fills missing permissions with defaults', () => {
    const result = parseMetaAdsConnectorPermissions({
      allowRead: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.allowRead).toBe(false)
    expect(result.value.allowWriteCampaigns).toBe(false)
    expect(result.value.allowWriteAdSets).toBe(false)
    expect(result.value.allowWriteAds).toBe(false)
  })

  it('rejects non-boolean permission values', () => {
    const result = parseMetaAdsConnectorPermissions({
      allowRead: 'true',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('allowRead must be a boolean')
  })

  it('requires specific key when requireAll is true', () => {
    const result = parseMetaAdsConnectorPermissions(
      { allowRead: true, allowWriteCampaigns: true, allowWriteAdSets: false },
      { requireAll: true }
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('allowWriteAds is required')
  })
})

describe('parseMetaAdsSelectedAdAccountIds', () => {
  it('returns empty array for undefined', () => {
    const result = parseMetaAdsSelectedAdAccountIds(undefined)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([])
  })

  it('rejects non-array values', () => {
    expect(parseMetaAdsSelectedAdAccountIds('string').ok).toBe(false)
    expect(parseMetaAdsSelectedAdAccountIds(123).ok).toBe(false)
    expect(parseMetaAdsSelectedAdAccountIds({}).ok).toBe(false)
  })

  it('normalizes and deduplicates account IDs', () => {
    const result = parseMetaAdsSelectedAdAccountIds(['123', 'act_456', '123'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual(['act_123', 'act_456'])
  })

  it('rejects invalid account IDs', () => {
    const result = parseMetaAdsSelectedAdAccountIds(['123', 'invalid'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('Invalid ad account id: invalid')
  })

  it('rejects non-string entries', () => {
    const result = parseMetaAdsSelectedAdAccountIds([123])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('selectedAdAccountIds must contain only strings')
  })
})

describe('parseMetaAdsConnectorConfig', () => {
  it('requires oauth authType', () => {
    const result = parseMetaAdsConnectorConfig({ authType: 'manual' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('Meta Ads connectors require OAuth')
  })

  it('requires appId and appSecret', () => {
    const result = parseMetaAdsConnectorConfig({ authType: 'oauth' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toContain('appId')
    expect(result.missing).toContain('appSecret')
  })

  it('parses valid config', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      permissions: { allowRead: true },
      selectedAdAccountIds: ['123'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.appId).toBe('my-app-id')
    expect(result.value.appSecret).toBe('my-app-secret')
    expect(result.value.selectedAdAccountIds).toEqual(['act_123'])
    expect(result.value.defaultAdAccountId).toBeUndefined()
  })

  it('rejects defaultAdAccountId not in selected list', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      selectedAdAccountIds: ['123'],
      defaultAdAccountId: '456',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('defaultAdAccountId must match one of the selected ad accounts')
  })

  it('rejects defaultAdAccountId not in selected list', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      selectedAdAccountIds: ['123'],
      defaultAdAccountId: '789',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('defaultAdAccountId must match one of the selected ad accounts')
  })

  it('rejects invalid defaultAdAccountId type', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      defaultAdAccountId: 123,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('defaultAdAccountId must be a string')
  })

  it('rejects invalid defaultAdAccountId format', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      defaultAdAccountId: 'not-valid',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('defaultAdAccountId must be a valid Meta ad account id')
  })

  it('ignores null defaultAdAccountId', () => {
    const result = parseMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      defaultAdAccountId: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.defaultAdAccountId).toBeUndefined()
  })
})

describe('validateMetaAdsConnectorConfig', () => {
  it('returns valid for complete config', () => {
    const result = validateMetaAdsConnectorConfig({
      authType: 'oauth',
      appId: 'my-app-id',
      appSecret: 'my-app-secret',
      selectedAdAccountIds: ['123'],
    })
    expect(result).toEqual({ valid: true })
  })

  it('returns invalid with missing for incomplete config', () => {
    const result = validateMetaAdsConnectorConfig({
      authType: 'oauth',
    })
    expect(result.valid).toBe(false)
    expect('missing' in result && result.missing).toContain('appId')
    expect('missing' in result && result.missing).toContain('appSecret')
  })

  it('returns message for invalid authType', () => {
    const result = validateMetaAdsConnectorConfig({
      authType: 'manual',
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.message).toBe('Meta Ads connectors require OAuth')
  })
})

describe('isMetaAdsConnectorReady', () => {
  it('returns true when read is allowed and accounts are selected', () => {
    expect(isMetaAdsConnectorReady({
      authType: 'oauth',
      appId: 'id',
      appSecret: 'secret',
      permissions: { allowRead: true },
      selectedAdAccountIds: ['123'],
    })).toBe(true)
  })

  it('returns false when read is disabled', () => {
    expect(isMetaAdsConnectorReady({
      authType: 'oauth',
      appId: 'id',
      appSecret: 'secret',
      permissions: { allowRead: false },
      selectedAdAccountIds: ['123'],
    })).toBe(false)
  })

  it('returns false when no accounts are selected', () => {
    expect(isMetaAdsConnectorReady({
      authType: 'oauth',
      appId: 'id',
      appSecret: 'secret',
      permissions: { allowRead: true },
      selectedAdAccountIds: [],
    })).toBe(false)
  })

  it('returns false when config is invalid', () => {
    expect(isMetaAdsConnectorReady({})).toBe(false)
  })
})
