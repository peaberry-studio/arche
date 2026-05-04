/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardEmptyState } from '../dashboard-empty-state'

type MockIconProps = {
  className?: string
  size?: number
  weight?: 'regular' | 'bold' | 'fill' | 'duotone'
}

const MockIcon = ({ size, weight, className }: MockIconProps) => (
  <svg data-testid="mock-icon" data-size={size} data-weight={weight} className={className} />
)

afterEach(() => {
  cleanup()
})

describe('DashboardEmptyState', () => {
  it('renders title and description', () => {
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="No items"
        description="You have not created any items yet."
      />
    )

    expect(screen.getByText('No items')).toBeDefined()
    expect(screen.getByText('You have not created any items yet.')).toBeDefined()
  })

  it('renders the icon component', () => {
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
      />
    )

    expect(screen.getByTestId('mock-icon')).toBeDefined()
  })

  it('renders primary action link', () => {
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
        primaryAction={{ label: 'Create new', href: '/new' }}
      />
    )

    const link = screen.getByRole('link', { name: 'Create new' })
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('/new')
  })

  it('renders primary action button with onClick', () => {
    const onClick = vi.fn()
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
        primaryAction={{ label: 'Create', onClick }}
      />
    )

    const button = screen.getByRole('button', { name: 'Create' })
    expect(button).toBeDefined()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders secondary action link', () => {
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
        secondaryAction={{ label: 'Learn more', href: '/docs' }}
      />
    )

    const link = screen.getByRole('link', { name: 'Learn more' })
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('/docs')
  })

  it('renders secondary action button with onClick', () => {
    const onClick = vi.fn()
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
        secondaryAction={{ label: 'Cancel', onClick }}
      />
    )

    const button = screen.getByRole('button', { name: 'Cancel' })
    expect(button).toBeDefined()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders both actions together', () => {
    render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
        primaryAction={{ label: 'Create', href: '/new' }}
        secondaryAction={{ label: 'Cancel', onClick: vi.fn() }}
      />
    )

    expect(screen.getByRole('link', { name: 'Create' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })

  it('does not render action area when no actions provided', () => {
    const { container } = render(
      <DashboardEmptyState
        icon={MockIcon}
        title="Title"
        description="Desc"
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.mt-6')).toBeNull()
  })
})
