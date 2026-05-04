/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemePicker } from '@/components/dashboard/theme-picker'

const mockTheme = {
  isDark: false,
  setThemeId: vi.fn(),
  themeId: 'ember',
  themes: [
    { id: 'ember', name: 'Ember', swatch: '#f97316' },
    { id: 'slate', name: 'Slate', swatch: '#64748b' },
  ],
  toggleDark: vi.fn(),
}

vi.mock('@/contexts/workspace-theme-context', () => ({
  useWorkspaceTheme: () => mockTheme,
}))

beforeEach(() => {
  mockTheme.isDark = false
  mockTheme.themeId = 'ember'
  mockTheme.setThemeId.mockReset()
  mockTheme.toggleDark.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ThemePicker', () => {
  it('renders theme swatches and toggles dark mode', () => {
    render(<ThemePicker />)

    fireEvent.click(screen.getByRole('button', { name: 'Slate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))

    expect(screen.getByRole('button', { name: 'Ember' }).className).toContain('scale-110')
    expect(mockTheme.setThemeId).toHaveBeenCalledWith('slate')
    expect(mockTheme.toggleDark).toHaveBeenCalledTimes(1)
  })

  it('renders the light-mode toggle when dark mode is active', () => {
    mockTheme.isDark = true

    render(<ThemePicker />)

    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeDefined()
  })
})
