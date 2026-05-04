/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UmamiConnectorFields } from '@/components/connectors/add-connector/umami/fields'

const baseProps = {
  umamiAuthMethod: 'api-key' as const,
  onUmamiAuthMethodChange: vi.fn(),
  umamiBaseUrl: '',
  onUmamiBaseUrlChange: vi.fn(),
  umamiApiKey: '',
  onUmamiApiKeyChange: vi.fn(),
  umamiUsername: '',
  onUmamiUsernameChange: vi.fn(),
  umamiPassword: '',
  onUmamiPasswordChange: vi.fn(),
}

describe('UmamiConnectorFields', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders API key auth fields and emits changes', () => {
    render(<UmamiConnectorFields {...baseProps} />)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.umami.is/v1' } })
    fireEvent.change(screen.getByLabelText('Authentication method'), { target: { value: 'login' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'api-key' } })

    expect(baseProps.onUmamiBaseUrlChange).toHaveBeenCalledWith('https://api.umami.is/v1')
    expect(baseProps.onUmamiAuthMethodChange).toHaveBeenCalledWith('login')
    expect(baseProps.onUmamiApiKeyChange).toHaveBeenCalledWith('api-key')
    expect(screen.queryByLabelText('Username')).toBeNull()
  })

  it('renders login auth fields and emits changes', () => {
    render(<UmamiConnectorFields {...baseProps} umamiAuthMethod="login" />)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://analytics.example.com' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })

    expect(baseProps.onUmamiBaseUrlChange).toHaveBeenCalledWith('https://analytics.example.com')
    expect(baseProps.onUmamiUsernameChange).toHaveBeenCalledWith('admin')
    expect(baseProps.onUmamiPasswordChange).toHaveBeenCalledWith('secret')
    expect(screen.queryByLabelText('API key')).toBeNull()
  })
})
