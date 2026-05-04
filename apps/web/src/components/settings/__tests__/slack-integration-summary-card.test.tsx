/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SlackIntegrationSummaryCard } from '../slack-integration-summary-card'

type MockLinkProps = {
  children: ReactNode
  href: string
}

type MockBadgeProps = {
  children: ReactNode
  variant?: string
}

type MockButtonProps = {
  asChild?: boolean
  children: ReactNode
  size?: string
}

vi.mock('next/link', () => ({
  default: ({ href, children }: MockLinkProps) => <a href={href}>{children}</a>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: MockBadgeProps) => <span data-testid="badge" data-variant={variant}>{children}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, size }: MockButtonProps) => (
    <button data-size={size} data-as-child={asChild}>{children}</button>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('SlackIntegrationSummaryCard', () => {
  const baseSummary = {
    enabled: true,
    status: 'connected' as const,
    configured: true,
    hasBotToken: true,
    hasAppToken: true,
    slackTeamId: 'T123',
    slackAppId: 'A123',
    slackBotUserId: 'U123',
    defaultAgentId: null,
    resolvedDefaultAgentId: null,
    lastError: null,
    lastSocketConnectedAt: null,
    lastEventAt: null,
    version: 1,
    updatedAt: null,
  }

  it('renders title and Setup link', () => {
    render(
      <SlackIntegrationSummaryCard slug="alice" integration={baseSummary} />
    )

    expect(screen.getByText('Slack integration')).toBeDefined()
    const setupLink = screen.getByRole('link', { name: 'Setup' })
    expect(setupLink).toBeDefined()
    expect(setupLink.getAttribute('href')).toBe('/u/alice/settings/integrations/slack')
  })

  it('shows Connected badge for connected status', () => {
    render(
      <SlackIntegrationSummaryCard slug="alice" integration={baseSummary} />
    )

    expect(screen.getByText('Connected')).toBeDefined()
    expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('default')
  })

  it('shows Connecting badge for connecting status', () => {
    render(
      <SlackIntegrationSummaryCard
        slug="alice"
        integration={{ ...baseSummary, status: 'connecting' }}
      />
    )

    expect(screen.getByText('Connecting')).toBeDefined()
    expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('outline')
  })

  it('shows Error badge for error status', () => {
    render(
      <SlackIntegrationSummaryCard
        slug="alice"
        integration={{ ...baseSummary, status: 'error' }}
      />
    )

    expect(screen.getByText('Error')).toBeDefined()
    expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('warning')
  })

  it('shows Disabled badge for disabled status', () => {
    render(
      <SlackIntegrationSummaryCard
        slug="alice"
        integration={{ ...baseSummary, status: 'disabled' }}
      />
    )

    expect(screen.getByText('Disabled')).toBeDefined()
    expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('secondary')
  })

  it('renders the description with code tag', () => {
    render(
      <SlackIntegrationSummaryCard slug="alice" integration={baseSummary} />
    )

    expect(screen.getByText('slack-bot')).toBeDefined()
  })
})
