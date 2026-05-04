/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigChangeBanner } from '../config-change-banner'

type ClassValue = string | false | null | undefined

type MockIconProps = {
  className?: string
}

vi.mock('@phosphor-icons/react', () => ({
  ArrowClockwise: ({ className }: MockIconProps) => <span data-testid="arrow-icon" className={className} />,
  Warning: () => <span data-testid="warning-icon" />,
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  getConfigChangeMessage: (reason: string | null) =>
    reason === 'provider_sync'
      ? 'Provider changes need a workspace restart to apply.'
      : 'Configuration changes detected. Restart to apply them.',
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: ClassValue[]) => args.filter(Boolean).join(' '),
}))

afterEach(() => {
  cleanup()
})

describe('ConfigChangeBanner', () => {
  it('returns null when not pending and no restart error', () => {
    const { container } = render(
      <ConfigChangeBanner
        pending={false}
        reason={null}
        restarting={false}
        restartError={null}
        onRestart={vi.fn()}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders default config change message', () => {
    render(
      <ConfigChangeBanner
        pending={true}
        reason="config"
        restarting={false}
        restartError={null}
        onRestart={vi.fn()}
      />
    )

    expect(
      screen.getByText('Configuration changes detected. Restart to apply them.')
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeDefined()
  })

  it('renders provider sync message', () => {
    render(
      <ConfigChangeBanner
        pending={true}
        reason="provider_sync"
        restarting={false}
        restartError={null}
        onRestart={vi.fn()}
      />
    )

    expect(
      screen.getByText('Provider changes need a workspace restart to apply.')
    ).toBeDefined()
  })

  it('renders restart error message', () => {
    render(
      <ConfigChangeBanner
        pending={false}
        reason={null}
        restarting={false}
        restartError="Container timeout"
        onRestart={vi.fn()}
      />
    )

    expect(
      screen.getByText('Restart failed: Container timeout')
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeDefined()
  })

  it('calls onRestart when button is clicked', () => {
    const onRestart = vi.fn()
    render(
      <ConfigChangeBanner
        pending={true}
        reason="config"
        restarting={false}
        restartError={null}
        onRestart={onRestart}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('disables the restart button when restarting', () => {
    render(
      <ConfigChangeBanner
        pending={true}
        reason="config"
        restarting={true}
        restartError={null}
        onRestart={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Restarting…' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders with amber background when pending without error', () => {
    const { container } = render(
      <ConfigChangeBanner
        pending={true}
        reason="config"
        restarting={false}
        restartError={null}
        onRestart={vi.fn()}
      />
    )

    const banner = container.firstElementChild
    expect(banner).toBeTruthy()
    expect(banner?.classList.contains('bg-amber-500')).toBe(true)
  })

  it('renders with destructive background when restart error is present', () => {
    const { container } = render(
      <ConfigChangeBanner
        pending={false}
        reason={null}
        restarting={false}
        restartError="fail"
        onRestart={vi.fn()}
      />
    )

    const banner = container.firstElementChild
    expect(banner).toBeTruthy()
    expect(banner?.classList.contains('bg-destructive')).toBe(true)
  })
})
