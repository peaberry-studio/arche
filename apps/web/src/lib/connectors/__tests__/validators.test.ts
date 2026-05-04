import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetConnectorAuthType = vi.fn()
const mockIsLinearOAuthActor = vi.fn()
const mockGetLinearOAuthActor = vi.fn()
const mockGetLinearOAuthScopeValidationError = vi.fn()
const mockIsOAuthConnectorType = vi.fn()
const mockValidateMetaAdsConnectorConfig = vi.fn()
const mockValidateUmamiConnectorConfig = vi.fn()
const mockValidateAhrefsConnectorConfig = vi.fn()
const mockValidateZendeskConnectorConfig = vi.fn()
const mockIsGoogleWorkspaceConnectorType = vi.fn()

vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: (config: Record<string, unknown>) => mockGetConnectorAuthType(config),
}))

vi.mock('@/lib/connectors/linear', () => ({
  getLinearOAuthActor: (config: Record<string, unknown>) => mockGetLinearOAuthActor(config),
  getLinearOAuthScopeValidationError: (scope: unknown, actor: string) => mockGetLinearOAuthScopeValidationError(scope, actor),
  isLinearOAuthActor: (value: unknown) => mockIsLinearOAuthActor(value),
}))

vi.mock('@/lib/connectors/oauth', () => ({
  isOAuthConnectorType: (type: string) => mockIsOAuthConnectorType(type),
}))

vi.mock('@/lib/connectors/meta-ads-config', () => ({
  validateMetaAdsConnectorConfig: (config: Record<string, unknown>) => mockValidateMetaAdsConnectorConfig(config),
}))

vi.mock('@/lib/connectors/umami-config', () => ({
  validateUmamiConnectorConfig: (config: Record<string, unknown>) => mockValidateUmamiConnectorConfig(config),
}))

vi.mock('@/lib/connectors/ahrefs-config', () => ({
  validateAhrefsConnectorConfig: (config: Record<string, unknown>) => mockValidateAhrefsConnectorConfig(config),
}))

vi.mock('@/lib/connectors/zendesk-config', () => ({
  validateZendeskConnectorConfig: (config: Record<string, unknown>) => mockValidateZendeskConnectorConfig(config),
}))

vi.mock('@/lib/connectors/google-workspace', () => ({
  isGoogleWorkspaceConnectorType: (type: string) => mockIsGoogleWorkspaceConnectorType(type),
}))

describe('validators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOAuthConnectorType.mockImplementation((type: string) =>
      ['linear', 'notion', 'custom', 'meta-ads', 'google_gmail', 'google_drive', 'google_calendar', 'google_chat', 'google_people'].includes(type)
    )
    mockIsGoogleWorkspaceConnectorType.mockImplementation((type: string) =>
      ['google_gmail', 'google_drive', 'google_calendar', 'google_chat', 'google_people'].includes(type)
    )
  })

  describe('validateConnectorType', () => {
    it('returns true for valid connector types', async () => {
      const { validateConnectorType } = await import('@/lib/connectors/validators')
      expect(validateConnectorType('linear')).toBe(true)
      expect(validateConnectorType('notion')).toBe(true)
      expect(validateConnectorType('zendesk')).toBe(true)
    })

    it('returns false for invalid connector types', async () => {
      const { validateConnectorType } = await import('@/lib/connectors/validators')
      expect(validateConnectorType('unknown')).toBe(false)
      expect(validateConnectorType('')).toBe(false)
    })
  })

  describe('validateConnectorName', () => {
    it('returns valid for a proper name', async () => {
      const { validateConnectorName } = await import('@/lib/connectors/validators')
      expect(validateConnectorName('My Connector')).toEqual({ valid: true })
    })

    it('returns invalid for non-string', async () => {
      const { validateConnectorName } = await import('@/lib/connectors/validators')
      expect(validateConnectorName(123)).toEqual({ valid: false, error: 'Name must be a string' })
    })

    it('returns invalid for empty string', async () => {
      const { validateConnectorName } = await import('@/lib/connectors/validators')
      expect(validateConnectorName('')).toEqual({ valid: false, error: 'Name cannot be empty' })
      expect(validateConnectorName('   ')).toEqual({ valid: false, error: 'Name cannot be empty' })
    })

    it('returns invalid for overly long name', async () => {
      const { validateConnectorName } = await import('@/lib/connectors/validators')
      const longName = 'a'.repeat(101)
      expect(validateConnectorName(longName)).toEqual({ valid: false, error: 'Name exceeds maximum length of 100' })
    })
  })

  describe('validateConnectorConfig', () => {
    it('delegates to meta-ads validator for meta-ads', async () => {
      mockValidateMetaAdsConnectorConfig.mockReturnValue({ valid: true })
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('meta-ads', {})
      expect(mockValidateMetaAdsConnectorConfig).toHaveBeenCalledWith({})
      expect(result).toEqual({ valid: true })
    })

    it('validates linear oauth with invalid actor', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsLinearOAuthActor.mockReturnValue(false)
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', { oauthActor: 'bad' })
      expect(result).toEqual({ valid: false, message: 'Linear OAuth actor must be user or app' })
    })

    it('validates linear oauth app actor missing client id and secret', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsLinearOAuthActor.mockReturnValue(true)
      mockGetLinearOAuthActor.mockReturnValue('app')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', { oauthActor: 'app' })
      expect(result).toEqual({ valid: false, message: 'Linear app actor OAuth requires both client ID and client secret' })
    })

    it('validates linear oauth app actor missing client secret', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsLinearOAuthActor.mockReturnValue(true)
      mockGetLinearOAuthActor.mockReturnValue('app')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', { oauthActor: 'app', oauthClientId: 'id' })
      expect(result).toEqual({ valid: false, message: 'Linear app actor OAuth requires both client ID and client secret' })
    })

    it('validates linear oauth scope error', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsLinearOAuthActor.mockReturnValue(true)
      mockGetLinearOAuthActor.mockReturnValue('user')
      mockGetLinearOAuthScopeValidationError.mockReturnValue('bad scope')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', { oauthActor: 'user', oauthScope: 'bad' })
      expect(result).toEqual({ valid: false, message: 'bad scope' })
    })

    it('validates custom oauth with endpoint', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('custom', { endpoint: 'https://example.com' })
      expect(result).toEqual({ valid: true })
    })

    it('validates custom oauth missing endpoint', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('custom', {})
      expect(result).toEqual({ valid: false, missing: ['endpoint'] })
    })

    it('returns valid for google workspace oauth', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('google_gmail', {})
      expect(result).toEqual({ valid: true })
    })

    it('returns valid for generic oauth connector', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('notion', { apiKey: 'key' })
      expect(result).toEqual({ valid: true })
    })

    it('rejects zendesk oauth', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsOAuthConnectorType.mockReturnValue(false)
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('zendesk', {})
      expect(result).toEqual({ valid: false, message: 'Zendesk connectors do not support OAuth' })
    })

    it('delegates to zendesk validator for manual auth', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      mockValidateZendeskConnectorConfig.mockReturnValue({ valid: true })
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('zendesk', {})
      expect(mockValidateZendeskConnectorConfig).toHaveBeenCalledWith({})
      expect(result).toEqual({ valid: true })
    })

    it('rejects ahrefs oauth', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsOAuthConnectorType.mockReturnValue(false)
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('ahrefs', {})
      expect(result).toEqual({ valid: false, message: 'Ahrefs connectors do not support OAuth' })
    })

    it('delegates to ahrefs validator for manual auth', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      mockValidateAhrefsConnectorConfig.mockReturnValue({ valid: true })
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('ahrefs', {})
      expect(mockValidateAhrefsConnectorConfig).toHaveBeenCalledWith({})
      expect(result).toEqual({ valid: true })
    })

    it('rejects umami oauth', async () => {
      mockGetConnectorAuthType.mockReturnValue('oauth')
      mockIsOAuthConnectorType.mockReturnValue(false)
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('umami', {})
      expect(result).toEqual({ valid: false, message: 'Umami connectors do not support OAuth' })
    })

    it('delegates to umami validator for manual auth', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      mockValidateUmamiConnectorConfig.mockReturnValue({ valid: true })
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('umami', {})
      expect(mockValidateUmamiConnectorConfig).toHaveBeenCalledWith({})
      expect(result).toEqual({ valid: true })
    })

    it('rejects google workspace manual auth', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('google_gmail', {})
      expect(result).toEqual({ valid: false, message: 'Google Workspace connectors only support OAuth' })
    })

    it('validates required fields for linear manual', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', {})
      expect(result).toEqual({ valid: false, missing: ['apiKey'] })
    })

    it('returns valid when all required fields are present', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('linear', { apiKey: 'key' })
      expect(result).toEqual({ valid: true })
    })

    it('validates required fields for notion', async () => {
      mockGetConnectorAuthType.mockReturnValue('manual')
      const { validateConnectorConfig } = await import('@/lib/connectors/validators')
      const result = validateConnectorConfig('notion', {})
      expect(result).toEqual({ valid: false, missing: ['apiKey'] })
    })
  })
})
