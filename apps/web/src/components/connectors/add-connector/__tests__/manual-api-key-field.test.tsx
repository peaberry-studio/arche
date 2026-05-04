/**
 * @vitest-environment jsdom
 */
import type { ChangeEvent, ReactNode } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManualApiKeyField } from '../manual-api-key-field'

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

describe('ManualApiKeyField', () => {
  it('renders with default label and placeholder', () => {
    render(<ManualApiKeyField id="key-1" value="" onChange={vi.fn()} />)

    expect(screen.getByLabelText('API Key')).toBeDefined()
    expect(screen.getByPlaceholderText('Paste your API key')).toBeDefined()
  })

  it('renders custom label and placeholder when provided', () => {
    render(
      <ManualApiKeyField
        id="key-2"
        label="Custom Label"
        placeholder="Custom placeholder"
        value=""
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Custom Label')).toBeDefined()
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeDefined()
  })

  it('calls onChange when input value changes', () => {
    const onChange = vi.fn()
    render(<ManualApiKeyField id="key-3" value="" onChange={onChange} />)

    const input = screen.getByPlaceholderText('Paste your API key')
    fireEvent.change(input, { target: { value: 'secret-key' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('secret-key')
  })

  it('renders helper text when provided', () => {
    render(
      <ManualApiKeyField
        id="key-4"
        value=""
        onChange={vi.fn()}
        helperText="Create an API key in your account settings."
      />
    )

    expect(
      screen.getByText('Create an API key in your account settings.')
    ).toBeDefined()
  })

  it('does not render helper text when not provided', () => {
    const { container } = render(
      <ManualApiKeyField id="key-5" value="" onChange={vi.fn()} />
    )

    expect(container.querySelector('p')).toBeNull()
  })

  it('renders input with password type', () => {
    render(<ManualApiKeyField id="key-6" value="secret" onChange={vi.fn()} />)

    const input = screen.getByPlaceholderText('Paste your API key')
    expect(input.getAttribute('type')).toBe('password')
  })
})
