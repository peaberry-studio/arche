/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddConnectorSectionHandle } from '@/components/connectors/add-connector/section-types'

import { AhrefsSection } from '../section'

type ManualApiKeyFieldProps = {
  helperText?: string
  id: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

type LabelProps = {
  children?: ReactNode
  className?: string
}

type AhrefsConfigState = {
  apiKey: string
}

function getSectionHandle(ref: RefObject<AddConnectorSectionHandle | null>) {
  if (!ref.current) {
    throw new Error('missing section handle')
  }

  return ref.current
}

vi.mock('@/components/connectors/add-connector/manual-api-key-field', () => ({
  ManualApiKeyField: ({ id, placeholder, value, onChange, helperText }: ManualApiKeyFieldProps) => (
    <div data-testid="manual-api-key-field">
      <input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        data-testid="api-key-input"
      />
      {helperText && <span data-testid="helper-text">{helperText}</span>}
    </div>
  ),
}))

vi.mock('@/components/connectors/add-connector/shared', () => ({
  buildDefaultName: (type: string) => `${type.charAt(0).toUpperCase() + type.slice(1)} Default`,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, className }: LabelProps) => <label className={className}>{children}</label>,
}))

vi.mock('./config', () => ({
  buildAhrefsConnectorConfig: vi.fn((state: AhrefsConfigState) => {
    if (!state.apiKey.trim()) {
      return { ok: false, message: 'Ahrefs API key is required.' }
    }
    return { ok: true, value: { apiKey: state.apiKey.trim() } }
  }),
  isAhrefsConnectorConfigurationComplete: (state: AhrefsConfigState) => Boolean(state.apiKey.trim()),
}))

afterEach(() => {
  cleanup()
})

describe('AhrefsSection', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <AhrefsSection onStateChange={vi.fn()} isActive={false} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders name field and API key input when active', () => {
    render(
      <AhrefsSection onStateChange={vi.fn()} isActive={true} />
    )

    expect(screen.getByText('Name')).toBeDefined()
    expect(screen.getByText('Ahrefs Default')).toBeDefined()
    expect(screen.getByTestId('manual-api-key-field')).toBeDefined()
    expect(screen.getByTestId('helper-text')).toBeDefined()
  })

  it('updates apiKey state when input changes', () => {
    render(
      <AhrefsSection onStateChange={vi.fn()} isActive={true} />
    )

    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: 'new-api-key' } })
    expect(input.getAttribute('value')).toBe('new-api-key')
  })

  it('exposes isComplete returning false when apiKey is empty', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(
      <AhrefsSection ref={ref} onStateChange={vi.fn()} isActive={true} />
    )

    expect(getSectionHandle(ref).isComplete()).toBe(false)
  })

  it('exposes isComplete returning true when apiKey is filled', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(
      <AhrefsSection ref={ref} onStateChange={vi.fn()} isActive={true} />
    )

    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: 'my-key' } })

    expect(getSectionHandle(ref).isComplete()).toBe(true)
  })

  it('exposes getSubmission returning error when apiKey is empty', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(
      <AhrefsSection ref={ref} onStateChange={vi.fn()} isActive={true} />
    )

    const result = getSectionHandle(ref).getSubmission()
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Ahrefs API key is required.')
  })

  it('exposes getSubmission returning success when apiKey is filled', () => {
    const ref = createRef<AddConnectorSectionHandle>()
    render(
      <AhrefsSection ref={ref} onStateChange={vi.fn()} isActive={true} />
    )

    const input = screen.getByTestId('api-key-input')
    fireEvent.change(input, { target: { value: 'my-key' } })

    const result = getSectionHandle(ref).getSubmission()
    expect(result.ok).toBe(true)
    expect(result.name).toBe('Ahrefs Default')
    expect(result.config).toEqual({ apiKey: 'my-key' })
  })
})
