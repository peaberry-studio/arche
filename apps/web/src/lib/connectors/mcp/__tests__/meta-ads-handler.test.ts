import { describe, expect, it, vi } from 'vitest'

const mockHandleEmbeddedConnectorMcpRequest = vi.fn()
const mockGetMetaAdsMcpProtocolVersion = vi.fn()
const mockGetMetaAdsMcpTools = vi.fn()
const mockParseMetaAdsConnectorConfig = vi.fn()
const mockExecuteMetaAdsMcpTool = vi.fn()

vi.mock('@/lib/connectors/mcp/json-rpc', () => ({
  handleEmbeddedConnectorMcpRequest: (...args: unknown[]) => mockHandleEmbeddedConnectorMcpRequest(...args),
}))

vi.mock('@/lib/connectors/meta-ads', () => ({
  executeMetaAdsMcpTool: (...args: unknown[]) => mockExecuteMetaAdsMcpTool(...args),
  getMetaAdsMcpProtocolVersion: () => mockGetMetaAdsMcpProtocolVersion(),
  getMetaAdsMcpTools: () => mockGetMetaAdsMcpTools(),
  parseMetaAdsConnectorConfig: (...args: unknown[]) => mockParseMetaAdsConnectorConfig(...args),
}))

import { handleMetaAdsMcpRequest } from '../meta-ads-handler'

describe('handleMetaAdsMcpRequest', () => {
  it('delegates to handleEmbeddedConnectorMcpRequest with correct parameters', async () => {
    mockGetMetaAdsMcpProtocolVersion.mockReturnValue('2024-11-05')
    mockHandleEmbeddedConnectorMcpRequest.mockResolvedValue(new Response('ok'))

    const request = new Request('http://localhost', { method: 'POST' })
    const decryptedConfig = { token: 'abc' }

    await handleMetaAdsMcpRequest(request, decryptedConfig)

    expect(mockHandleEmbeddedConnectorMcpRequest).toHaveBeenCalledOnce()
    const callArg = mockHandleEmbeddedConnectorMcpRequest.mock.calls[0][0] as {
      request: Request
      decryptedConfig: Record<string, unknown>
      connectorLabel: string
      serverInfo: { name: string; version: string }
      protocolVersion: string
      getTools: unknown
      parseConfig: unknown
      executeTool: unknown
    }
    expect(callArg.request).toBe(request)
    expect(callArg.decryptedConfig).toBe(decryptedConfig)
    expect(callArg.connectorLabel).toBe('Meta Ads')
    expect(callArg.serverInfo).toEqual({ name: 'arche-meta-ads-connector', version: '0.1.0' })
    expect(callArg.protocolVersion).toBe('2024-11-05')
    expect(typeof callArg.getTools).toBe('function')
    expect(typeof callArg.parseConfig).toBe('function')
    expect(typeof callArg.executeTool).toBe('function')
  })

  it('calls executeMetaAdsMcpTool when executeTool is invoked', async () => {
    mockGetMetaAdsMcpProtocolVersion.mockReturnValue('2024-11-05')
    let capturedExecuteTool: ((config: unknown, toolName: string, args: unknown) => Promise<unknown>) | undefined
    mockHandleEmbeddedConnectorMcpRequest.mockImplementation((input: { executeTool: typeof capturedExecuteTool }) => {
      capturedExecuteTool = input.executeTool
      return Promise.resolve(new Response('ok'))
    })

    const request = new Request('http://localhost', { method: 'POST' })
    const decryptedConfig = { token: 'abc' }

    await handleMetaAdsMcpRequest(request, decryptedConfig)
    expect(capturedExecuteTool).toBeDefined()

    await capturedExecuteTool?.(decryptedConfig, 'testTool', { arg: 1 })
    expect(mockExecuteMetaAdsMcpTool).toHaveBeenCalledWith(decryptedConfig, 'testTool', { arg: 1 })
  })

  it('returns the response from handleEmbeddedConnectorMcpRequest', async () => {
    const expectedResponse = new Response('meta-ads-response')
    mockGetMetaAdsMcpProtocolVersion.mockReturnValue('2024-11-05')
    mockHandleEmbeddedConnectorMcpRequest.mockResolvedValue(expectedResponse)

    const request = new Request('http://localhost', { method: 'POST' })
    const result = await handleMetaAdsMcpRequest(request, {})

    expect(result).toBe(expectedResponse)
  })
})
