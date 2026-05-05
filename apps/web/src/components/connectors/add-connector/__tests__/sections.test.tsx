/** @vitest-environment jsdom */

import { createRef } from 'react'
import type { RefObject } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddConnectorSectionHandle } from '@/components/connectors/add-connector/section-types'
import { CustomSection } from '@/components/connectors/add-connector/custom/section'
import { GoogleWorkspaceSection } from '@/components/connectors/add-connector/google-workspace/section'
import { LinearSection } from '@/components/connectors/add-connector/linear/section'
import { MetaAdsSection } from '@/components/connectors/add-connector/meta-ads/section'
import { NotionSection } from '@/components/connectors/add-connector/notion/section'
import { UmamiSection } from '@/components/connectors/add-connector/umami/section'
import { ZendeskSection } from '@/components/connectors/add-connector/zendesk/section'

function getHandle(ref: RefObject<AddConnectorSectionHandle | null>) {
  if (!ref.current) {
    throw new Error('missing section handle')
  }

  return ref.current
}

function expectSuccessfulSubmission(ref: RefObject<AddConnectorSectionHandle | null>) {
  const result = getHandle(ref).getSubmission()
  if (!result.ok) {
    throw new Error(result.message)
  }

  return result
}

describe('add connector sections', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders nothing while inactive', () => {
    const { container } = render(<CustomSection isActive={false} onStateChange={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })

  it('submits custom manual connector settings', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<CustomSection ref={ref} isActive onStateChange={vi.fn()} />)

    expect(getHandle(ref).isComplete()).toBe(false)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    expect(getHandle(ref).getSubmission()).toEqual({ ok: false, message: 'Name is required.' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom MCP' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.change(screen.getByLabelText(/Auth token/), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText(/Headers/), { target: { value: '{"x-test":"1"}' } })

    expect(getHandle(ref).isComplete()).toBe(true)
    const result = expectSuccessfulSubmission(ref)
    expect(result.name).toBe('Custom MCP')
    expect(result.config).toMatchObject({
      authType: 'manual',
      endpoint: 'https://mcp.example.com',
      auth: 'secret',
      headers: { 'x-test': '1' },
    })
  })

  it('submits custom OAuth connector settings', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<CustomSection ref={ref} isActive onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'oauth' } })
    fireEvent.change(screen.getByLabelText('MCP endpoint'), { target: { value: 'https://mcp.example.com' } })
    fireEvent.change(screen.getByLabelText(/OAuth scope/), { target: { value: 'read write' } })
    fireEvent.change(screen.getByLabelText(/Client ID/), { target: { value: 'client-id' } })
    fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: 'client-secret' } })
    fireEvent.change(screen.getByLabelText(/Authorization endpoint/), { target: { value: 'https://auth.example.com' } })
    fireEvent.change(screen.getByLabelText(/Token endpoint/), { target: { value: 'https://token.example.com' } })
    fireEvent.change(screen.getByLabelText(/Registration endpoint/), { target: { value: 'https://register.example.com' } })

    expect(screen.getByText('Connect OAuth')).toBeTruthy()
    expect(getHandle(ref).isComplete()).toBe(true)
    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authType: 'oauth',
      endpoint: 'https://mcp.example.com',
      oauthScope: 'read write',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      oauthAuthorizationEndpoint: 'https://auth.example.com',
      oauthTokenEndpoint: 'https://token.example.com',
      oauthRegistrationEndpoint: 'https://register.example.com',
    })
  })

  it('submits Linear OAuth and manual settings', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<LinearSection ref={ref} isActive onStateChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Admin access/ }))
    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authType: 'oauth',
      oauthScope: 'read,admin',
    })

    fireEvent.change(screen.getByLabelText('OAuth actor'), { target: { value: 'app' } })

    expect(screen.queryByRole('checkbox', { name: /Admin access/ })).toBeNull()
    expect(getHandle(ref).getSubmission()).toEqual({
      ok: false,
      message: 'Linear app actor OAuth requires client ID and client secret.',
    })

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'linear-client' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'linear-secret' } })

    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authType: 'oauth',
      oauthScope: 'read',
      oauthActor: 'app',
      oauthClientId: 'linear-client',
      oauthClientSecret: 'linear-secret',
    })

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'manual' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'linear-key' } })

    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authType: 'manual',
      apiKey: 'linear-key',
    })

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'oauth' } })

    expect(screen.getByText('Connect OAuth')).toBeTruthy()
  })

  it('supports Notion OAuth and manual API-key submissions', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<NotionSection ref={ref} isActive onStateChange={vi.fn()} />)

    expect(getHandle(ref).isComplete()).toBe(true)
    expect(expectSuccessfulSubmission(ref).config).toEqual({ authType: 'oauth' })

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'manual' } })
    expect(getHandle(ref).isComplete()).toBe(false)
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'notion-secret' } })

    const result = expectSuccessfulSubmission(ref)
    expect(result.config).toEqual({ authType: 'manual', apiKey: 'notion-secret' })
  })

  it('submits Meta Ads app credentials', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<MetaAdsSection ref={ref} isActive onStateChange={vi.fn()} />)

    expect(getHandle(ref).getSubmission()).toEqual({ ok: false, message: 'Meta Ads App ID is required.' })
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'app-id' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'app-secret' } })

    expect(getHandle(ref).isComplete()).toBe(true)
    const result = expectSuccessfulSubmission(ref)
    expect(result.name).toBe('Meta Ads')
    expect(result.config).toMatchObject({
      authType: 'oauth',
      appId: 'app-id',
      appSecret: 'app-secret',
      selectedAdAccountIds: [],
    })
  })

  it('submits Google Workspace OAuth configuration', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(
      <GoogleWorkspaceSection
        ref={ref}
        connectorType="google_chat"
        isActive
        onStateChange={vi.fn()}
      />
    )

    expect(screen.getByText('Configure the Chat app in Google Cloud.')).toBeTruthy()
    expect(getHandle(ref).isComplete()).toBe(true)
    const result = expectSuccessfulSubmission(ref)
    expect(result.name).toBe('Google Chat')
    expect(result.config).toEqual({ authType: 'oauth' })
  })

  it('submits Umami API-key and login configurations', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<UmamiSection ref={ref} isActive onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.umami.is/v1' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'umami-key' } })
    expect(getHandle(ref).isComplete()).toBe(true)
    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is/v1',
      apiKey: 'umami-key',
    })

    fireEvent.change(screen.getByLabelText('Authentication method'), { target: { value: 'login' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })

    expect(expectSuccessfulSubmission(ref).config).toEqual({
      authMethod: 'login',
      baseUrl: 'https://api.umami.is/v1',
      username: 'admin',
      password: 'password',
    })
  })

  it('submits Zendesk credentials', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(<ZendeskSection ref={ref} isActive onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Zendesk subdomain'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Agent email'), { target: { value: 'agent@example.com' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'zendesk-token' } })

    expect(getHandle(ref).isComplete()).toBe(true)
    const result = expectSuccessfulSubmission(ref)
    expect(result.name).toBe('Zendesk')
    expect(result.config).toEqual({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'zendesk-token',
    })
  })
})
