import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAhrefsMcpTools: vi.fn(),
  getConnectorAuthType: vi.fn(),
  getConnectorMcpServerUrl: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  getMetaAdsMcpTools: vi.fn(),
  getUmamiMcpTools: vi.fn(),
  getZendeskMcpTools: vi.fn(),
  parseAhrefsConnectorConfig: vi.fn(),
  parseMetaAdsConnectorConfig: vi.fn(),
  parseUmamiConnectorConfig: vi.fn(),
  parseZendeskConnectorConfig: vi.fn(),
  validateConnectorTestEndpoint: vi.fn(),
}))

vi.mock('@/lib/connectors/ahrefs', () => ({
  getAhrefsMcpTools: mocks.getAhrefsMcpTools,
  parseAhrefsConnectorConfig: mocks.parseAhrefsConnectorConfig,
}))
vi.mock('@/lib/connectors/meta-ads', () => ({
  getMetaAdsMcpTools: mocks.getMetaAdsMcpTools,
  parseMetaAdsConnectorConfig: mocks.parseMetaAdsConnectorConfig,
}))
vi.mock('@/lib/connectors/mcp/server-url', () => ({
  getConnectorMcpServerUrl: mocks.getConnectorMcpServerUrl,
}))
vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: mocks.getConnectorAuthType,
  getConnectorOAuthConfig: mocks.getConnectorOAuthConfig,
}))
vi.mock('@/lib/connectors/umami', () => ({
  getUmamiMcpTools: mocks.getUmamiMcpTools,
  parseUmamiConnectorConfig: mocks.parseUmamiConnectorConfig,
}))
vi.mock('@/lib/connectors/zendesk', () => ({
  getZendeskMcpTools: mocks.getZendeskMcpTools,
  parseZendeskConnectorConfig: mocks.parseZendeskConnectorConfig,
}))
vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: mocks.validateConnectorTestEndpoint,
}))

import { loadConnectorToolInventory } from '@/lib/connectors/tool-inventory'

function validConfig(value: Record<string, unknown> = {}) {
  return { ok: true as const, value }
}

describe('loadConnectorToolInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    mocks.parseAhrefsConnectorConfig.mockReturnValue(validConfig())
    mocks.parseMetaAdsConnectorConfig.mockReturnValue(validConfig())
    mocks.parseUmamiConnectorConfig.mockReturnValue(validConfig())
    mocks.parseZendeskConnectorConfig.mockReturnValue(validConfig())
    mocks.getAhrefsMcpTools.mockReturnValue([{ name: 'backlinks', description: 'Read backlinks' }])
    mocks.getMetaAdsMcpTools.mockReturnValue([{ name: 'list_campaigns', description: 'List campaigns' }])
    mocks.getUmamiMcpTools.mockReturnValue([{ name: 'get_websites', description: 'List websites' }])
    mocks.getZendeskMcpTools.mockReturnValue([
      { name: 'search_tickets', description: 'Search tickets' },
      { name: 'create-ticket' },
    ])
    mocks.getConnectorAuthType.mockReturnValue('manual')
    mocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.example/rpc')
    mocks.getConnectorOAuthConfig.mockReturnValue(null)
    mocks.validateConnectorTestEndpoint.mockResolvedValue({
      ok: true,
      url: new URL('https://validated.example/rpc'),
    })
  })

  it('returns embedded connector tools with display titles', async () => {
    const result = await loadConnectorToolInventory({
      type: 'zendesk',
      config: { subdomain: 'acme' },
    })

    expect(result).toEqual({
      ok: true,
      tools: [
        { name: 'search_tickets', title: 'Search tickets', description: 'Search tickets' },
        { name: 'create-ticket', title: 'Create ticket', description: undefined },
      ],
    })
  })

  it('returns embedded connector config errors', async () => {
    mocks.parseMetaAdsConnectorConfig.mockReturnValue({ ok: false })

    const result = await loadConnectorToolInventory({
      type: 'meta-ads',
      config: {},
    })

    expect(result).toEqual({
      ok: false,
      tools: [],
      message: 'Meta Ads connector config is invalid.',
    })
  })

  it('loads Meta Ads embedded connector tools', async () => {
    const result = await loadConnectorToolInventory({
      type: 'meta-ads',
      config: { appId: 'app-id' },
    })

    expect(result).toEqual({
      ok: true,
      tools: [{ name: 'list_campaigns', title: 'List campaigns', description: 'List campaigns' }],
    })
  })

  it('loads the remaining embedded connector inventories', async () => {
    await expect(loadConnectorToolInventory({ type: 'ahrefs', config: { apiKey: 'ahrefs-key' } })).resolves.toEqual({
      ok: true,
      tools: [{ name: 'backlinks', title: 'Backlinks', description: 'Read backlinks' }],
    })
    await expect(loadConnectorToolInventory({ type: 'umami', config: { apiKey: 'umami-key' } })).resolves.toEqual({
      ok: true,
      tools: [{ name: 'get_websites', title: 'Get websites', description: 'List websites' }],
    })
  })

  it('loads remote tools with connector headers and API key auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          tools: [
            { name: 'list_issues', description: 'List issues' },
            { name: '  ' },
            null,
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadConnectorToolInventory({
      type: 'linear',
      config: {
        apiKey: 'linear-key',
        headers: {
          'x-extra': 'yes',
          ignored: 42,
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      tools: [{ name: 'list_issues', title: 'List issues', description: 'List issues' }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mcp.example/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-extra': 'yes',
          Authorization: 'Bearer linear-key',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tools-list',
          method: 'tools/list',
        }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('uses API key auth for any remote connector inventory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { tools: [{ name: 'list_messages' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadConnectorToolInventory({
      type: 'google_gmail',
      config: { apiKey: 'remote-key' },
    })

    expect(result).toEqual({
      ok: true,
      tools: [{ name: 'list_messages', title: 'List messages', description: undefined }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mcp.example/rpc',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer remote-key' }),
      }),
    )
  })

  it('loads remote tools with OAuth access tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { tools: [{ name: 'search_pages' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.getConnectorAuthType.mockReturnValueOnce('oauth')
    mocks.getConnectorOAuthConfig.mockReturnValueOnce({ accessToken: 'oauth-token' })

    const result = await loadConnectorToolInventory({
      type: 'notion',
      config: {},
    })

    expect(result).toEqual({
      ok: true,
      tools: [{ name: 'search_pages', title: 'Search pages', description: undefined }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mcp.example/rpc',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
      }),
    )
  })

  it('validates custom endpoints before loading remote tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { tools: [{ name: 'custom_tool' }] },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.getConnectorMcpServerUrl.mockReturnValue('https://input.example/mcp')

    const result = await loadConnectorToolInventory({
      type: 'custom',
      config: { auth: 'custom-token' },
    })

    expect(result).toEqual({
      ok: true,
      tools: [{ name: 'custom_tool', title: 'Custom tool', description: undefined }],
    })
    expect(mocks.validateConnectorTestEndpoint).toHaveBeenCalledWith('https://input.example/mcp')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://validated.example/rpc',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer custom-token' }),
      }),
    )
  })

  it('returns remote connector setup and authentication errors', async () => {
    mocks.getConnectorMcpServerUrl.mockReturnValueOnce(undefined)
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Connector does not expose a remote MCP endpoint.',
    })

    mocks.getConnectorMcpServerUrl.mockReturnValueOnce('not a url')
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Connector endpoint is invalid.',
    })

    mocks.validateConnectorTestEndpoint.mockResolvedValueOnce({ ok: false })
    await expect(loadConnectorToolInventory({ type: 'custom', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Connector endpoint is not allowed.',
    })

    mocks.getConnectorAuthType.mockReturnValueOnce('oauth')
    mocks.getConnectorOAuthConfig.mockReturnValueOnce(null)
    await expect(loadConnectorToolInventory({ type: 'linear', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Connector is not authenticated.',
    })
  })

  it('returns remote MCP response errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }))
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Remote MCP server did not return tools.',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { tools: [] } }),
    }))
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Remote MCP server returned no tools.',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    }))
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Remote MCP server returned no tools.',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')))
    await expect(loadConnectorToolInventory({ type: 'notion', config: {} })).resolves.toEqual({
      ok: false,
      tools: [],
      message: 'Remote MCP tools could not be loaded.',
    })
  })
})
