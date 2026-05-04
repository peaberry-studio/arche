/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DashboardThemeShell } from '@/components/dashboard/dashboard-theme-shell'

vi.mock('@/contexts/workspace-theme-context', () => ({
  useWorkspaceTheme: () => ({ themeId: 'ocean-mist', isDark: false }),
}))

describe('DashboardThemeShell', () => {
  it('renders children inside themed container', () => {
    render(
      <DashboardThemeShell>
        <div data-testid="child">Hello</div>
      </DashboardThemeShell>
    )

    expect(screen.getByTestId('child')).toBeDefined()
  })
})
