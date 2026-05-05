import { describe, expect, it } from 'vitest'

import {
  buildLinearOAuthScope,
  getLinearOAuthActor,
  getLinearOAuthClientCredentials,
  getLinearOAuthModeLabel,
  getLinearOAuthScopeValidationError,
  isLinearOAuthActor,
  isLinearOptionalOAuthScope,
  isLinearOAuthScopeAllowedForActor,
  LINEAR_OAUTH_SCOPE_OPTIONS,
  LINEAR_READ_OAUTH_SCOPE,
  parseLinearOptionalOAuthScopes,
  resolveLinearOAuthActor,
} from '@/lib/connectors/linear'

describe('isLinearOAuthActor', () => {
  it('returns true for valid actors', () => {
    expect(isLinearOAuthActor('user')).toBe(true)
    expect(isLinearOAuthActor('app')).toBe(true)
  })

  it('returns false for invalid actors', () => {
    expect(isLinearOAuthActor('admin')).toBe(false)
    expect(isLinearOAuthActor('')).toBe(false)
    expect(isLinearOAuthActor(null)).toBe(false)
    expect(isLinearOAuthActor(undefined)).toBe(false)
  })
})

describe('isLinearOptionalOAuthScope', () => {
  it('returns true for valid optional scopes', () => {
    for (const option of LINEAR_OAUTH_SCOPE_OPTIONS) {
      expect(isLinearOptionalOAuthScope(option.scope)).toBe(true)
    }
  })

  it('returns false for invalid scopes', () => {
    expect(isLinearOptionalOAuthScope('invalid')).toBe(false)
    expect(isLinearOptionalOAuthScope('')).toBe(false)
    expect(isLinearOptionalOAuthScope(null)).toBe(false)
  })

  it('returns false for read scope', () => {
    expect(isLinearOptionalOAuthScope('read')).toBe(false)
  })
})

describe('getLinearOAuthActor', () => {
  it('returns the configured actor when valid', () => {
    expect(getLinearOAuthActor({ oauthActor: 'app' })).toBe('app')
    expect(getLinearOAuthActor({ oauthActor: 'user' })).toBe('user')
  })

  it('defaults to user when invalid or missing', () => {
    expect(getLinearOAuthActor({})).toBe('user')
    expect(getLinearOAuthActor({ oauthActor: 'unknown' })).toBe('user')
  })
})

describe('isLinearOAuthScopeAllowedForActor', () => {
  it('allows app scopes for app actor', () => {
    expect(isLinearOAuthScopeAllowedForActor('app:assignable', 'app')).toBe(true)
    expect(isLinearOAuthScopeAllowedForActor('customer:read', 'app')).toBe(true)
  })

  it('allows user scopes for user actor', () => {
    expect(isLinearOAuthScopeAllowedForActor('write', 'user')).toBe(true)
    expect(isLinearOAuthScopeAllowedForActor('admin', 'user')).toBe(true)
  })

  it('rejects user-only scopes for app actor', () => {
    expect(isLinearOAuthScopeAllowedForActor('admin', 'app')).toBe(false)
    expect(isLinearOAuthScopeAllowedForActor('write', 'app')).toBe(true)
  })

  it('rejects app-only scopes for user actor', () => {
    expect(isLinearOAuthScopeAllowedForActor('app:assignable', 'user')).toBe(false)
    expect(isLinearOAuthScopeAllowedForActor('customer:read', 'user')).toBe(false)
  })
})

describe('parseLinearOptionalOAuthScopes', () => {
  it('returns empty array for non-string values', () => {
    expect(parseLinearOptionalOAuthScopes(null)).toEqual([])
    expect(parseLinearOptionalOAuthScopes(undefined)).toEqual([])
    expect(parseLinearOptionalOAuthScopes(42)).toEqual([])
    expect(parseLinearOptionalOAuthScopes({})).toEqual([])
  })

  it('returns empty array for empty strings', () => {
    expect(parseLinearOptionalOAuthScopes('')).toEqual([])
    expect(parseLinearOptionalOAuthScopes('   ')).toEqual([])
  })

  it('excludes read scope and deduplicates', () => {
    const result = parseLinearOptionalOAuthScopes('write,read,write')
    expect(result).toEqual(['write'])
  })

  it('supports space-separated, comma-separated, and mixed delimiters', () => {
    const result = parseLinearOptionalOAuthScopes('write issues:create,comments:create')
    expect(result).toEqual(['write', 'issues:create', 'comments:create'])
  })

  it('ignores invalid scopes', () => {
    const result = parseLinearOptionalOAuthScopes('write invalid_scope admin')
    expect(result).toEqual(['write', 'admin'])
  })
})

describe('buildLinearOAuthScope', () => {
  it('always includes read scope', () => {
    expect(buildLinearOAuthScope([])).toBe('read')
    expect(buildLinearOAuthScope(['write'])).toBe('read,write')
  })

  it('deduplicates and normalizes scopes', () => {
    expect(buildLinearOAuthScope(['write', 'write', 'admin'])).toBe('read,write,admin')
  })

  it('excludes invalid scopes', () => {
    expect(buildLinearOAuthScope(['invalid'])).toBe('read')
  })
})

describe('getLinearOAuthScopeValidationError', () => {
  it('returns undefined for undefined input', () => {
    expect(getLinearOAuthScopeValidationError(undefined, 'user')).toBeUndefined()
  })

  it('returns empty-string error for empty string input', () => {
    expect(getLinearOAuthScopeValidationError('', 'user')).toBe('Linear OAuth scope must be a non-empty string')
  })

  it('validates non-string values', () => {
    expect(getLinearOAuthScopeValidationError(42, 'user')).toBe('Linear OAuth scope must be a non-empty string')
    expect(getLinearOAuthScopeValidationError({}, 'user')).toBe('Linear OAuth scope must be a non-empty string')
  })

  it('rejects unsupported scopes', () => {
    expect(getLinearOAuthScopeValidationError('invalid_scope', 'user')).toBe('Linear OAuth scope contains unsupported permissions')
  })

  it('rejects admin scope for app actor', () => {
    expect(getLinearOAuthScopeValidationError('admin', 'app')).toBe('Linear app actor OAuth cannot request admin scope')
  })

  it('rejects user scopes for app actor', () => {
    expect(getLinearOAuthScopeValidationError('write admin', 'app')).toBe('Linear app actor OAuth cannot request admin scope')
  })

  it('rejects app-only scopes for user actor', () => {
    expect(getLinearOAuthScopeValidationError('app:assignable', 'user')).toBe('Linear user OAuth cannot request app-only permissions')
  })

  it('allows valid scopes for user actor', () => {
    expect(getLinearOAuthScopeValidationError('write,issues:create', 'user')).toBeUndefined()
    expect(getLinearOAuthScopeValidationError('read,write', 'user')).toBeUndefined()
  })

  it('allows valid scopes for app actor', () => {
    expect(getLinearOAuthScopeValidationError('customer:read,app:assignable', 'app')).toBeUndefined()
  })
})

describe('getLinearOAuthClientCredentials', () => {
  it('returns null when credentials are missing', () => {
    expect(getLinearOAuthClientCredentials({})).toBeNull()
    expect(getLinearOAuthClientCredentials({ oauthClientId: 'id' })).toBeNull()
    expect(getLinearOAuthClientCredentials({ oauthClientSecret: 'secret' })).toBeNull()
  })

  it('returns credentials when both are present', () => {
    const result = getLinearOAuthClientCredentials({
      oauthClientId: 'my-client-id',
      oauthClientSecret: 'my-client-secret',
    })
    expect(result).toEqual({
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
    })
  })

  it('ignores empty string values', () => {
    expect(getLinearOAuthClientCredentials({
      oauthClientId: '',
      oauthClientSecret: 'secret',
    })).toBeNull()
    expect(getLinearOAuthClientCredentials({
      oauthClientId: '  ',
      oauthClientSecret: 'secret',
    })).toBeNull()
  })
})

describe('resolveLinearOAuthActor', () => {
  it('returns actor for linear oauth connectors', () => {
    expect(resolveLinearOAuthActor('linear', 'oauth', { oauthActor: 'app' })).toBe('app')
    expect(resolveLinearOAuthActor('linear', 'oauth', {})).toBe('user')
  })

  it('returns undefined for non-linear connectors', () => {
    expect(resolveLinearOAuthActor('zendesk', 'oauth', { oauthActor: 'app' })).toBeUndefined()
  })

  it('returns undefined for non-oauth auth types', () => {
    expect(resolveLinearOAuthActor('linear', 'manual', {})).toBeUndefined()
  })
})

describe('getLinearOAuthModeLabel', () => {
  it('returns null for non-linear or non-oauth connectors', () => {
    expect(getLinearOAuthModeLabel({ type: 'zendesk', authType: 'oauth' })).toBeNull()
    expect(getLinearOAuthModeLabel({ type: 'linear', authType: 'manual' })).toBeNull()
  })

  it('returns App actor OAuth for app actor', () => {
    expect(getLinearOAuthModeLabel({
      type: 'linear',
      authType: 'oauth',
      oauthActor: 'app',
    })).toBe('App actor OAuth')
  })

  it('returns User OAuth for user actor or default', () => {
    expect(getLinearOAuthModeLabel({
      type: 'linear',
      authType: 'oauth',
      oauthActor: 'user',
    })).toBe('User OAuth')
    expect(getLinearOAuthModeLabel({
      type: 'linear',
      authType: 'oauth',
    })).toBe('User OAuth')
  })
})

describe('LINEAR constant exports', () => {
  it('includes read scope', () => {
    expect(LINEAR_READ_OAUTH_SCOPE).toBe('read')
  })

  it('defines valid oauth actors', () => {
    expect(LINEAR_OAUTH_SCOPE_OPTIONS.length).toBeGreaterThan(0)
    for (const option of LINEAR_OAUTH_SCOPE_OPTIONS) {
      expect(option).toHaveProperty('scope')
      expect(option).toHaveProperty('label')
      expect(option).toHaveProperty('description')
      expect(option).toHaveProperty('actors')
      expect(Array.isArray(option.actors)).toBe(true)
    }
  })
})
