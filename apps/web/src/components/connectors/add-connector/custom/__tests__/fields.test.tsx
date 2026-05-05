/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CustomConnectorFields } from '@/components/connectors/add-connector/custom/fields'

const baseProps = {
  endpoint: '',
  onEndpointChange: vi.fn(),
  auth: '',
  onAuthChange: vi.fn(),
  headersText: '',
  onHeadersTextChange: vi.fn(),
  oauthScope: '',
  onOauthScopeChange: vi.fn(),
  oauthClientId: '',
  onOauthClientIdChange: vi.fn(),
  oauthClientSecret: '',
  onOauthClientSecretChange: vi.fn(),
  oauthAuthorizationEndpoint: '',
  onOauthAuthorizationEndpointChange: vi.fn(),
  oauthTokenEndpoint: '',
  onOauthTokenEndpointChange: vi.fn(),
  oauthRegistrationEndpoint: '',
  onOauthRegistrationEndpointChange: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CustomConnectorFields', () => {
  it('renders manual connector fields and emits changes', () => {
    render(<CustomConnectorFields {...baseProps} authType="manual" />)

    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.change(screen.getByLabelText(/Auth token/), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText(/Headers/), { target: { value: '{"x":"1"}' } })

    expect(baseProps.onEndpointChange).toHaveBeenCalledWith('https://mcp.example.com')
    expect(baseProps.onAuthChange).toHaveBeenCalledWith('secret')
    expect(baseProps.onHeadersTextChange).toHaveBeenCalledWith('{"x":"1"}')
    expect(screen.queryByLabelText(/OAuth scope/)).toBeNull()
  })

  it('renders OAuth connector fields and emits changes', () => {
    render(<CustomConnectorFields {...baseProps} authType="oauth" />)

    fireEvent.change(screen.getByLabelText('MCP endpoint'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.change(screen.getByLabelText(/OAuth scope/), { target: { value: 'read write' } })
    fireEvent.change(screen.getByLabelText(/Client ID/), { target: { value: 'client-id' } })
    fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: 'client-secret' } })
    fireEvent.change(screen.getByLabelText(/Authorization endpoint/), { target: { value: 'https://auth.example.com' } })
    fireEvent.change(screen.getByLabelText(/Token endpoint/), { target: { value: 'https://token.example.com' } })
    fireEvent.change(screen.getByLabelText(/Registration endpoint/), { target: { value: 'https://register.example.com' } })

    expect(baseProps.onEndpointChange).toHaveBeenCalledWith('https://mcp.example.com')
    expect(baseProps.onOauthScopeChange).toHaveBeenCalledWith('read write')
    expect(baseProps.onOauthClientIdChange).toHaveBeenCalledWith('client-id')
    expect(baseProps.onOauthClientSecretChange).toHaveBeenCalledWith('client-secret')
    expect(baseProps.onOauthAuthorizationEndpointChange).toHaveBeenCalledWith('https://auth.example.com')
    expect(baseProps.onOauthTokenEndpointChange).toHaveBeenCalledWith('https://token.example.com')
    expect(baseProps.onOauthRegistrationEndpointChange).toHaveBeenCalledWith('https://register.example.com')
    expect(screen.queryByLabelText(/Headers/)).toBeNull()
  })
})
