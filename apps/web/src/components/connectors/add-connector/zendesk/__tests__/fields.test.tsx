/**
 * @vitest-environment jsdom
 */
import type { ChangeEvent, ReactNode } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ZendeskConnectorFields } from '../fields'

type MockInputProps = {
  id?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  type?: string
  value?: string
}

type MockLabelProps = {
  children?: ReactNode
  className?: string
  htmlFor?: string
}

vi.mock('@/components/ui/input', () => ({
  Input: ({ id, type, value, onChange, placeholder }: MockInputProps) => (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ htmlFor, className, children }: MockLabelProps) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('ZendeskConnectorFields', () => {
  it('renders all three field groups', () => {
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail=""
        onZendeskEmailChange={vi.fn()}
        apiToken=""
        onApiTokenChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Zendesk subdomain')).toBeDefined()
    expect(screen.getByLabelText('Agent email')).toBeDefined()
    expect(screen.getByLabelText('API token')).toBeDefined()
  })

  it('renders with given values', () => {
    render(
      <ZendeskConnectorFields
        zendeskSubdomain="acme"
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail="agent@example.com"
        onZendeskEmailChange={vi.fn()}
        apiToken="secret-token"
        onApiTokenChange={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('acme')).toBeDefined()
    expect(screen.getByDisplayValue('agent@example.com')).toBeDefined()
    expect(screen.getByDisplayValue('secret-token')).toBeDefined()
  })

  it('fires subdomain change on input change', () => {
    const onZendeskSubdomainChange = vi.fn()
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={onZendeskSubdomainChange}
        zendeskEmail=""
        onZendeskEmailChange={vi.fn()}
        apiToken=""
        onApiTokenChange={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('acme')
    fireEvent.change(input, { target: { value: 'mycompany' } })
    expect(onZendeskSubdomainChange).toHaveBeenCalledTimes(1)
    expect(onZendeskSubdomainChange).toHaveBeenCalledWith('mycompany')
  })

  it('fires email change on input change', () => {
    const onZendeskEmailChange = vi.fn()
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail=""
        onZendeskEmailChange={onZendeskEmailChange}
        apiToken=""
        onApiTokenChange={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('agent@example.com')
    fireEvent.change(input, { target: { value: 'new@example.com' } })
    expect(onZendeskEmailChange).toHaveBeenCalledTimes(1)
    expect(onZendeskEmailChange).toHaveBeenCalledWith('new@example.com')
  })

  it('fires api token change on input change', () => {
    const onApiTokenChange = vi.fn()
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail=""
        onZendeskEmailChange={vi.fn()}
        apiToken=""
        onApiTokenChange={onApiTokenChange}
      />
    )

    const input = screen.getByPlaceholderText('Paste your Zendesk API token')
    fireEvent.change(input, { target: { value: 'new-token' } })
    expect(onApiTokenChange).toHaveBeenCalledTimes(1)
    expect(onApiTokenChange).toHaveBeenCalledWith('new-token')
  })

  it('renders email input with type email', () => {
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail="test@test.com"
        onZendeskEmailChange={vi.fn()}
        apiToken=""
        onApiTokenChange={vi.fn()}
      />
    )

    const emailInput = screen.getByLabelText('Agent email')
    expect(emailInput.getAttribute('type')).toBe('email')
  })

  it('renders api token input with type password', () => {
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail=""
        onZendeskEmailChange={vi.fn()}
        apiToken="secret"
        onApiTokenChange={vi.fn()}
      />
    )

    const tokenInput = screen.getByLabelText('API token')
    expect(tokenInput.getAttribute('type')).toBe('password')
  })

  it('renders subdomain helper text', () => {
    render(
      <ZendeskConnectorFields
        zendeskSubdomain=""
        onZendeskSubdomainChange={vi.fn()}
        zendeskEmail=""
        onZendeskEmailChange={vi.fn()}
        apiToken=""
        onApiTokenChange={vi.fn()}
      />
    )

    expect(
      screen.getByText(/Enter the account subdomain/)
    ).toBeDefined()
  })
})
