/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdvancedSettingsPanel } from '@/components/settings/advanced-settings-panel'

vi.mock('@/app/u/[slug]/settings/security/workspace-restart-section', () => ({
  WorkspaceRestartSection: ({ slug, showHeader }: { slug: string; showHeader?: boolean }) => (
    <div data-testid="workspace-restart-section" data-slug={slug} data-show-header={String(showHeader)}>
      WorkspaceRestartSection
    </div>
  ),
}))

afterEach(() => {
  cleanup()
})

describe('AdvancedSettingsPanel', () => {
  it('renders heading and description', () => {
    render(<AdvancedSettingsPanel slug="alice" />)

    expect(screen.getByRole('heading', { name: 'Advanced' })).toBeDefined()
    expect(
      screen.getByText('Low-level controls for rebuilding and restarting this workspace.')
    ).toBeDefined()
  })

  it('renders WorkspaceRestartSection with correct props', () => {
    render(<AdvancedSettingsPanel slug="alice" />)

    const section = screen.getByTestId('workspace-restart-section')
    expect(section).toBeDefined()
    expect(section.getAttribute('data-slug')).toBe('alice')
    expect(section.getAttribute('data-show-header')).toBe('false')
  })
})
