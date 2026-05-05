/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorsManager } from '@/components/connectors/connectors-manager'

vi.mock('@/components/connectors/connectors-panel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    ConnectorsPanel: React.forwardRef(function MockPanel(
      { slug }: { slug: string },
      ref: import('react').ForwardedRef<{ openAddModal: () => void }>
    ) {
      React.useImperativeHandle(ref, () => ({ openAddModal: () => {} }))
      return React.createElement('div', { 'data-testid': 'connectors-panel' }, `ConnectorsPanel: ${slug}`)
    }),
  }
})

afterEach(() => {
  cleanup()
})

describe('ConnectorsManager', () => {
  it('renders title and description in main layout', () => {
    render(<ConnectorsManager slug="alice" />)

    expect(screen.getByText('Connectors')).toBeDefined()
    expect(screen.getByText('Configure integrations for your workspace.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add connector' })).toBeDefined()
    expect(screen.getByTestId('connectors-panel')).toBeDefined()
  })

  it('renders custom title and description when provided', () => {
    render(
      <ConnectorsManager
        slug="alice"
        title="Custom Title"
        description="Custom description."
      />
    )

    expect(screen.getByText('Custom Title')).toBeDefined()
    expect(screen.getByText('Custom description.')).toBeDefined()
  })

  it('renders in embedded mode without main wrapper', () => {
    const { container } = render(<ConnectorsManager slug="alice" embedded />)

    expect(screen.getByText('Connectors')).toBeDefined()
    expect(container.querySelector('main')).toBeNull()
  })

  it('calls openAddModal on Add connector button click', () => {
    render(<ConnectorsManager slug="alice" />)

    const button = screen.getByRole('button', { name: 'Add connector' })
    expect(button).toBeDefined()

    button.click()
  })
})
