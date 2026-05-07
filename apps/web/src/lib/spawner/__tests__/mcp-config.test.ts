import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { ConnectorRecord } from '../mcp-config'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const connectorMocks = vi.hoisted(() => ({
  parseAhrefsConnectorConfig: vi.fn(),
  parseZendeskConnectorConfig: vi.fn(),
  parseUmamiConnectorConfig: vi.fn(),
  decryptConfig: vi.fn(),
  getConnectorGatewayBaseUrl: vi.fn(),
  issueConnectorGatewayToken: vi.fn(),
  getConnectorAuthType: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  validateConnectorConfig: vi.fn(),
  validateConnectorType: vi.fn(),
}))

const serviceMocks = vi.hoisted(() => ({
  userService: {
    findIdBySlug: vi.fn(),
  },
  connectorService: {
    findEnabledMcpByUserId: vi.fn(),
  },
}))

vi.mock('@/lib/connectors/ahrefs', () => ({
  parseAhrefsConnectorConfig: connectorMocks.parseAhrefsConnectorConfig,
}))

vi.mock('@/lib/connectors/zendesk', () => ({
  parseZendeskConnectorConfig: connectorMocks.parseZendeskConnectorConfig,
}))

vi.mock('@/lib/connectors/umami', () => ({
  parseUmamiConnectorConfig: connectorMocks.parseUmamiConnectorConfig,
}))

vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: connectorMocks.decryptConfig,
}))

vi.mock('@/lib/connectors/gateway-config', () => ({
  getConnectorGatewayBaseUrl: connectorMocks.getConnectorGatewayBaseUrl,
}))

vi.mock('@/lib/connectors/gateway-tokens', () => ({
  issueConnectorGatewayToken: connectorMocks.issueConnectorGatewayToken,
}))

vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: connectorMocks.getConnectorAuthType,
  getConnectorOAuthConfig: connectorMocks.getConnectorOAuthConfig,
}))

vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorConfig: connectorMocks.validateConnectorConfig,
  validateConnectorType: connectorMocks.validateConnectorType,
}))

vi.mock('@/lib/services', () => serviceMocks)

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  buildMcpServerKey,
  buildMcpConfigFromConnectors,
  buildMcpConfigForSlug,
} from '../mcp-config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: 'conn-1',
    type: 'notion',
    name: 'My Connector',
    enabled: true,
    config: 'encrypted-config',
    ...overrides,
  }
}

/** Sets up all mocks so a connector passes the basic gate checks. */
function passGates(decrypted: Record<string, unknown> = { apiKey: 'key-123' }) {
  connectorMocks.validateConnectorType.mockReturnValue(true)
  connectorMocks.decryptConfig.mockReturnValue(decrypted)
  connectorMocks.validateConnectorConfig.mockReturnValue({ valid: true })
  connectorMocks.getConnectorAuthType.mockReturnValue('manual')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mcp-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // buildMcpServerKey
  // -------------------------------------------------------------------------

  describe('buildMcpServerKey', () => {
    it('returns arche_{type}_{id}', () => {
      expect(buildMcpServerKey('notion', 'abc-123')).toBe('arche_notion_abc-123')
      expect(buildMcpServerKey('linear', 'xyz')).toBe('arche_linear_xyz')
      expect(buildMcpServerKey('custom', '1')).toBe('arche_custom_1')
    })
  })

  // -------------------------------------------------------------------------
  // buildMcpConfigFromConnectors — structural / gate checks
  // -------------------------------------------------------------------------

  describe('buildMcpConfigFromConnectors', () => {
    it('returns an empty mcp map with correct $schema when no connectors are provided', () => {
      const result = buildMcpConfigFromConnectors([])
      expect(result.mcpConfig.$schema).toBe('https://opencode.ai/config.json')
      expect(result.mcpConfig.mcp).toEqual({})
    })

    it('skips disabled connectors', () => {
      const connector = makeConnector({ enabled: false })
      const result = buildMcpConfigFromConnectors([connector])
      expect(result.mcpConfig.mcp).toEqual({})
      expect(connectorMocks.decryptConfig).not.toHaveBeenCalled()
    })

    it('skips connectors with invalid type', () => {
      connectorMocks.validateConnectorType.mockReturnValue(false)
      const connector = makeConnector({ type: 'invalid' })
      const result = buildMcpConfigFromConnectors([connector])
      expect(result.mcpConfig.mcp).toEqual({})
    })

    it('skips connectors when decryptConfig throws', () => {
      connectorMocks.validateConnectorType.mockReturnValue(true)
      connectorMocks.decryptConfig.mockImplementation(() => {
        throw new Error('decrypt failed')
      })
      const connector = makeConnector()
      const result = buildMcpConfigFromConnectors([connector])
      expect(result.mcpConfig.mcp).toEqual({})
    })

    it('skips connectors when config validation fails', () => {
      connectorMocks.validateConnectorType.mockReturnValue(true)
      connectorMocks.decryptConfig.mockReturnValue({ apiKey: 'k' })
      connectorMocks.validateConnectorConfig.mockReturnValue({ valid: false, missing: ['apiKey'] })
      const connector = makeConnector()
      const result = buildMcpConfigFromConnectors([connector])
      expect(result.mcpConfig.mcp).toEqual({})
    })

    // -----------------------------------------------------------------------
    // Notion connector
    // -----------------------------------------------------------------------

    describe('notion', () => {
      it('builds local MCP config with apiKey for manual auth', () => {
        passGates({ apiKey: 'ntn_secret_123' })
        const connector = makeConnector({ type: 'notion', id: 'n1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_notion_n1']).toEqual({
          type: 'local',
          command: ['npx', '-y', '@suekou/mcp-notion-server'],
          enabled: true,
          environment: { NOTION_API_TOKEN: 'ntn_secret_123' },
        })
      })

      it('skips notion manual connector when apiKey is empty', () => {
        passGates({ apiKey: '  ' })
        const connector = makeConnector({ type: 'notion', id: 'n1' })
        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('skips notion manual connector when apiKey is not a string', () => {
        passGates({ apiKey: 42 })
        const connector = makeConnector({ type: 'notion', id: 'n1' })
        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('builds remote MCP config with OAuth access token', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'notion',
          accessToken: 'oauth-token-abc',
          clientId: 'client-1',
          connectedAt: '2024-01-01',
        })
        const connector = makeConnector({ type: 'notion', id: 'n1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_notion_n1']).toEqual({
          type: 'remote',
          url: 'https://mcp.notion.com/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer oauth-token-abc' },
          oauth: false,
        })
      })

      it('skips notion OAuth connector when accessToken is missing', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue(null)
        const connector = makeConnector({ type: 'notion', id: 'n1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('uses gateway target for notion OAuth when available', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')

        const connector = makeConnector({ type: 'notion', id: 'n1' })
        const result = buildMcpConfigFromConnectors([connector], {
          gatewayTargets: {
            'n1': { url: 'http://gateway/n1/mcp', token: 'gw-token' },
          },
        })

        expect(result.mcpConfig.mcp['arche_notion_n1']).toEqual({
          type: 'remote',
          url: 'http://gateway/n1/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer gw-token' },
          oauth: false,
        })
        // Should not call getConnectorOAuthConfig when gateway target is used
        expect(connectorMocks.getConnectorOAuthConfig).not.toHaveBeenCalled()
      })
    })

    // -----------------------------------------------------------------------
    // Linear connector
    // -----------------------------------------------------------------------

    describe('linear', () => {
      it('builds remote MCP config with apiKey for manual auth', () => {
        passGates({ apiKey: 'lin_key_123' })
        const connector = makeConnector({ type: 'linear', id: 'l1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_linear_l1']).toEqual({
          type: 'remote',
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer lin_key_123' },
          oauth: false,
        })
      })

      it('returns stored connector tool permissions with the MCP server key', () => {
        passGates({
          apiKey: 'lin_key_123',
          mcpToolPermissions: {
            list_issues: 'allow',
            create_issue: 'ask',
          },
        })
        const connector = makeConnector({ type: 'linear', id: 'l1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.connectorToolPermissions).toEqual({
          arche_linear_l1: {
            list_issues: 'allow',
            create_issue: 'ask',
          },
        })
      })

      it('skips linear manual connector when apiKey is missing', () => {
        passGates({ apiKey: '' })
        const connector = makeConnector({ type: 'linear', id: 'l1' })
        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('builds remote MCP config with OAuth access token', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'linear',
          accessToken: 'lin-oauth-token',
          clientId: 'client-1',
          connectedAt: '2024-01-01',
        })
        const connector = makeConnector({ type: 'linear', id: 'l1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_linear_l1']).toEqual({
          type: 'remote',
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer lin-oauth-token' },
          oauth: false,
        })
      })

      it('skips linear OAuth when accessToken is missing', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue(null)
        const connector = makeConnector({ type: 'linear', id: 'l1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('uses gateway target for linear OAuth when available', () => {
        passGates()
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        const connector = makeConnector({ type: 'linear', id: 'l1' })

        const result = buildMcpConfigFromConnectors([connector], {
          gatewayTargets: {
            'l1': { url: 'http://gateway/l1/mcp', token: 'gw-token' },
          },
        })

        expect(result.mcpConfig.mcp['arche_linear_l1']).toEqual({
          type: 'remote',
          url: 'http://gateway/l1/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer gw-token' },
          oauth: false,
        })
      })
    })

    // -----------------------------------------------------------------------
    // Custom connector
    // -----------------------------------------------------------------------

    describe('custom', () => {
      it('builds remote MCP config with endpoint for manual auth', () => {
        passGates({ endpoint: 'https://my-server.example.com/mcp' })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']).toEqual({
          type: 'remote',
          url: 'https://my-server.example.com/mcp',
          enabled: true,
          headers: undefined,
          oauth: undefined,
        })
      })

      it('skips custom manual connector when endpoint is missing', () => {
        passGates({ endpoint: '' })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('includes auth header when auth is provided', () => {
        passGates({ endpoint: 'https://example.com/mcp', auth: 'my-bearer-token' })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers).toEqual({
          Authorization: 'Bearer my-bearer-token',
        })
        expect(result.mcpConfig.mcp['arche_custom_c1']!.oauth).toBe(false)
      })

      it('includes custom headers', () => {
        passGates({
          endpoint: 'https://example.com/mcp',
          headers: { 'X-Custom': 'val', 'X-Other': 'val2' },
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers).toEqual({
          'X-Custom': 'val',
          'X-Other': 'val2',
        })
      })

      it('does not override existing Authorization header with auth field', () => {
        passGates({
          endpoint: 'https://example.com/mcp',
          auth: 'should-not-override',
          headers: { Authorization: 'Bearer existing' },
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers!.Authorization).toBe('Bearer existing')
      })

      it('ignores non-string header values', () => {
        passGates({
          endpoint: 'https://example.com/mcp',
          headers: { 'X-Good': 'ok', 'X-Bad': 42, 'X-Null': null },
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers).toEqual({ 'X-Good': 'ok' })
      })

      it('ignores headers when it is not an object', () => {
        passGates({ endpoint: 'https://example.com/mcp', headers: 'not-an-object' })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers).toBeUndefined()
      })

      it('ignores headers when it is an array', () => {
        passGates({ endpoint: 'https://example.com/mcp', headers: ['a', 'b'] })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.headers).toBeUndefined()
      })

      it('builds remote MCP config with OAuth access token', () => {
        passGates({ endpoint: 'https://example.com/mcp' })
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'custom',
          accessToken: 'custom-oauth-token',
          clientId: 'client-1',
          connectedAt: '2024-01-01',
          mcpServerUrl: null,
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']).toEqual({
          type: 'remote',
          url: 'https://example.com/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer custom-oauth-token' },
          oauth: false,
        })
      })

      it('uses mcpServerUrl from OAuth config when available', () => {
        passGates({ endpoint: 'https://fallback.com/mcp' })
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'custom',
          accessToken: 'custom-oauth-token',
          clientId: 'client-1',
          connectedAt: '2024-01-01',
          mcpServerUrl: 'https://mcp-override.com/mcp',
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])

        expect(result.mcpConfig.mcp['arche_custom_c1']!.url).toBe('https://mcp-override.com/mcp')
      })

      it('skips custom OAuth connector when accessToken is missing', () => {
        passGates({ endpoint: 'https://example.com/mcp' })
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue(null)
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('skips custom OAuth connector when no endpoint and no mcpServerUrl', () => {
        passGates({})
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'custom',
          accessToken: 'token',
          clientId: 'cid',
          connectedAt: '2024-01-01',
          mcpServerUrl: null,
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })

      it('uses gateway target for custom OAuth when available', () => {
        passGates({ endpoint: 'https://example.com/mcp', headers: { 'X-Extra': 'v' } })
        connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
        connectorMocks.getConnectorOAuthConfig.mockReturnValue({
          provider: 'custom',
          accessToken: 'custom-oauth',
          clientId: 'cid',
          connectedAt: '2024-01-01',
          mcpServerUrl: null,
        })
        const connector = makeConnector({ type: 'custom', id: 'c1' })

        const result = buildMcpConfigFromConnectors([connector], {
          gatewayTargets: {
            'c1': { url: 'http://gateway/c1/mcp', token: 'gw-token' },
          },
        })

        expect(result.mcpConfig.mcp['arche_custom_c1']).toEqual({
          type: 'remote',
          url: 'http://gateway/c1/mcp',
          enabled: true,
          headers: {
            'X-Extra': 'v',
            Authorization: 'Bearer gw-token',
          },
          oauth: false,
        })
      })
    })

    // -----------------------------------------------------------------------
    // Embedded connectors (zendesk, ahrefs, umami)
    // -----------------------------------------------------------------------

    describe('embedded connectors (zendesk, ahrefs, umami)', () => {
      const embeddedTypes = [
        { type: 'zendesk' as const, parser: connectorMocks.parseZendeskConnectorConfig },
        { type: 'ahrefs' as const, parser: connectorMocks.parseAhrefsConnectorConfig },
        { type: 'umami' as const, parser: connectorMocks.parseUmamiConnectorConfig },
      ]

      for (const { type, parser } of embeddedTypes) {
        describe(type, () => {
          it('builds remote MCP config via gateway when parser succeeds', () => {
            passGates({ subdomain: 'test', email: 'e', apiToken: 't' })
            parser.mockReturnValue({ ok: true })
            const connector = makeConnector({ type, id: `${type}-1` })

            const result = buildMcpConfigFromConnectors([connector], {
              gatewayTargets: {
                [`${type}-1`]: { url: `http://gateway/${type}-1/mcp`, token: 'gw-token' },
              },
            })

            expect(result.mcpConfig.mcp[`arche_${type}_${type}-1`]).toEqual({
              type: 'remote',
              url: `http://gateway/${type}-1/mcp`,
              enabled: true,
              headers: { Authorization: 'Bearer gw-token' },
              oauth: false,
            })
          })

          it('skips when parser returns ok: false', () => {
            passGates()
            parser.mockReturnValue({ ok: false })
            const connector = makeConnector({ type, id: `${type}-1` })

            const result = buildMcpConfigFromConnectors([connector], {
              gatewayTargets: {
                [`${type}-1`]: { url: `http://gateway/${type}-1/mcp`, token: 'gw-token' },
              },
            })

            expect(result.mcpConfig.mcp).toEqual({})
          })

          it('skips when no gateway target is provided', () => {
            passGates()
            parser.mockReturnValue({ ok: true })
            const connector = makeConnector({ type, id: `${type}-1` })

            const result = buildMcpConfigFromConnectors([connector])
            expect(result.mcpConfig.mcp).toEqual({})
          })
        })
      }
    })

    // -----------------------------------------------------------------------
    // Unknown / default connector type
    // -----------------------------------------------------------------------

    describe('unknown type', () => {
      it('skips connectors with an unrecognized type that passes validateConnectorType', () => {
        // If validateConnectorType returns true for a type we don't handle in the switch
        passGates()
        const connector = makeConnector({ type: 'future-type' as string, id: 'f1' })

        const result = buildMcpConfigFromConnectors([connector])
        expect(result.mcpConfig.mcp).toEqual({})
      })
    })

    // -----------------------------------------------------------------------
    // Multiple connectors
    // -----------------------------------------------------------------------

    describe('multiple connectors', () => {
      it('processes multiple connectors and only includes valid ones', () => {
        connectorMocks.validateConnectorType.mockReturnValue(true)
        connectorMocks.validateConnectorConfig.mockReturnValue({ valid: true })
        connectorMocks.getConnectorAuthType.mockReturnValue('manual')

        // First connector: valid notion
        connectorMocks.decryptConfig
          .mockReturnValueOnce({ apiKey: 'notion-key' })
          // Second connector: will throw on decrypt
          .mockImplementationOnce(() => { throw new Error('bad') })
          // Third connector: valid linear
          .mockReturnValueOnce({ apiKey: 'linear-key' })

        const connectors = [
          makeConnector({ type: 'notion', id: 'n1', config: 'enc1' }),
          makeConnector({ type: 'linear', id: 'l1', config: 'enc2' }),
          makeConnector({ type: 'linear', id: 'l2', config: 'enc3' }),
        ]

        const result = buildMcpConfigFromConnectors(connectors)

        expect(Object.keys(result.mcpConfig.mcp)).toHaveLength(2)
        expect(result.mcpConfig.mcp['arche_notion_n1']).toBeDefined()
        expect(result.mcpConfig.mcp['arche_linear_l2']).toBeDefined()
        // The second connector (l1) should have been skipped due to decrypt error
        expect(result.mcpConfig.mcp['arche_linear_l1']).toBeUndefined()
      })
    })
  })

  // -------------------------------------------------------------------------
  // buildMcpConfigForSlug
  // -------------------------------------------------------------------------

  describe('buildMcpConfigForSlug', () => {
    beforeEach(() => {
      connectorMocks.getConnectorGatewayBaseUrl.mockReturnValue('http://gateway')
      connectorMocks.issueConnectorGatewayToken.mockReturnValue('gw-token-123')
      connectorMocks.validateConnectorType.mockReturnValue(true)
      connectorMocks.validateConnectorConfig.mockReturnValue({ valid: true })
    })

    it('returns null when user is not found', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue(null)

      const result = await buildMcpConfigForSlug('unknown-slug')

      expect(result).toBeNull()
    })

    it('returns null when no connectors produce MCP entries', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([])

      const result = await buildMcpConfigForSlug('my-slug')

      expect(result).toBeNull()
    })

    it('builds gateway targets for embedded connectors', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const zendeskConnector = makeConnector({
        type: 'zendesk',
        id: 'z1',
        config: 'enc-zendesk',
      })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([zendeskConnector])

      connectorMocks.decryptConfig.mockReturnValue({ subdomain: 'acme', email: 'a@b.com', apiToken: 'tok' })
      connectorMocks.parseZendeskConnectorConfig.mockReturnValue({ ok: true })
      connectorMocks.getConnectorAuthType.mockReturnValue('manual')

      const result = await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).toHaveBeenCalledWith({
        userId: 'user-1',
        workspaceSlug: 'my-slug',
        connectorId: 'z1',
      })

      expect(result).not.toBeNull()
      expect(result!.mcpConfig.mcp['arche_zendesk_z1']).toEqual({
        type: 'remote',
        url: 'http://gateway/z1/mcp',
        enabled: true,
        headers: { Authorization: 'Bearer gw-token-123' },
        oauth: false,
      })
    })

    it('builds gateway targets for OAuth connectors', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const notionConnector = makeConnector({
        type: 'notion',
        id: 'n1',
        config: 'enc-notion',
      })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([notionConnector])

      connectorMocks.decryptConfig.mockReturnValue({ authType: 'oauth', oauth: { provider: 'notion', accessToken: 'at' } })
      connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
      connectorMocks.getConnectorOAuthConfig.mockReturnValue({
        provider: 'notion',
        accessToken: 'at',
        clientId: 'cid',
        connectedAt: '2024-01-01',
      })

      const result = await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).toHaveBeenCalledWith({
        userId: 'user-1',
        workspaceSlug: 'my-slug',
        connectorId: 'n1',
      })

      expect(result).not.toBeNull()
      expect(result!.mcpConfig.mcp['arche_notion_n1']!.url).toBe('http://gateway/n1/mcp')
    })

    it('skips invalid connector types during gateway target building', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      connectorMocks.validateConnectorType.mockReturnValue(false)

      const connector = makeConnector({ type: 'invalid' as string, id: 'i1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      const result = await buildMcpConfigForSlug('my-slug')

      expect(result).toBeNull()
    })

    it('skips connectors that fail decryption during gateway target building', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'notion', id: 'n1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      connectorMocks.decryptConfig.mockImplementation(() => { throw new Error('decrypt fail') })

      const result = await buildMcpConfigForSlug('my-slug')

      expect(result).toBeNull()
    })

    it('skips OAuth connectors without access token during gateway target building', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'notion', id: 'n1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      connectorMocks.decryptConfig.mockReturnValue({ authType: 'oauth' })
      connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
      connectorMocks.getConnectorOAuthConfig.mockReturnValue(null)

      const result = await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('skips custom OAuth connectors without endpoint or mcpServerUrl', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'custom', id: 'c1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      connectorMocks.decryptConfig.mockReturnValue({ authType: 'oauth' })
      connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
      connectorMocks.getConnectorOAuthConfig.mockReturnValue({
        provider: 'custom',
        accessToken: 'token',
        clientId: 'cid',
        connectedAt: '2024-01-01',
        mcpServerUrl: undefined,
      })

      await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).not.toHaveBeenCalled()
    })

    it('allows custom OAuth connectors with mcpServerUrl but no endpoint', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'custom', id: 'c1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      connectorMocks.decryptConfig.mockReturnValue({ authType: 'oauth' })
      connectorMocks.getConnectorAuthType.mockReturnValue('oauth')
      connectorMocks.getConnectorOAuthConfig.mockReturnValue({
        provider: 'custom',
        accessToken: 'token',
        clientId: 'cid',
        connectedAt: '2024-01-01',
        mcpServerUrl: 'https://custom-server.com/mcp',
      })
      connectorMocks.validateConnectorConfig.mockReturnValue({ valid: true })

      await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).toHaveBeenCalledWith({
        userId: 'user-1',
        workspaceSlug: 'my-slug',
        connectorId: 'c1',
      })
    })

    it('skips embedded connectors whose parser returns ok: false', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'ahrefs', id: 'a1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      connectorMocks.decryptConfig.mockReturnValue({ apiKey: 'ahrefs-key' })
      connectorMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: false })
      connectorMocks.getConnectorAuthType.mockReturnValue('manual')

      const result = await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('skips manual non-embedded connectors during gateway target building', async () => {
      serviceMocks.userService.findIdBySlug.mockResolvedValue({ id: 'user-1' })

      const connector = makeConnector({ type: 'notion', id: 'n1' })
      serviceMocks.connectorService.findEnabledMcpByUserId.mockResolvedValue([connector])

      // Manual auth, not an embedded connector => no gateway target
      connectorMocks.decryptConfig.mockReturnValue({ apiKey: 'notion-key' })
      connectorMocks.getConnectorAuthType.mockReturnValue('manual')

      const result = await buildMcpConfigForSlug('my-slug')

      expect(connectorMocks.issueConnectorGatewayToken).not.toHaveBeenCalled()
      // But should still produce a local config
      expect(result).not.toBeNull()
      expect(result!.mcpConfig.mcp['arche_notion_n1']!.type).toBe('local')
    })
  })
})
