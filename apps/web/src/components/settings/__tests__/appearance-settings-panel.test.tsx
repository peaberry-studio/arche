/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppearanceSettingsPanel } from '@/components/settings/appearance-settings-panel'

const mockTheme = {
  canDecreaseChatFontSize: true,
  canIncreaseChatFontSize: true,
  chatFontFamily: 'sans' as const,
  chatFontSize: 15,
  decreaseChatFontSize: vi.fn(),
  increaseChatFontSize: vi.fn(),
  isDark: false,
  setChatFontFamily: vi.fn(),
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
  mockTheme.canDecreaseChatFontSize = true
  mockTheme.canIncreaseChatFontSize = true
  mockTheme.chatFontFamily = 'sans'
  mockTheme.chatFontSize = 15
  mockTheme.isDark = false
  mockTheme.themeId = 'ember'
  mockTheme.decreaseChatFontSize.mockReset()
  mockTheme.increaseChatFontSize.mockReset()
  mockTheme.setChatFontFamily.mockReset()
  mockTheme.setThemeId.mockReset()
  mockTheme.toggleDark.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AppearanceSettingsPanel', () => {
  it('renders theme controls and dispatches appearance changes', () => {
    render(<AppearanceSettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Slate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Serif' }))
    fireEvent.click(screen.getByRole('button', { name: 'Smaller' }))
    fireEvent.click(screen.getByRole('button', { name: 'Larger' }))

    expect(screen.getByText('15px')).toBeDefined()
    expect(mockTheme.setThemeId).toHaveBeenCalledWith('slate')
    expect(mockTheme.toggleDark).toHaveBeenCalledTimes(1)
    expect(mockTheme.setChatFontFamily).toHaveBeenCalledWith('serif')
    expect(mockTheme.decreaseChatFontSize).toHaveBeenCalledTimes(1)
    expect(mockTheme.increaseChatFontSize).toHaveBeenCalledTimes(1)
  })

  it('reflects dark mode and disabled font-size bounds', () => {
    mockTheme.canDecreaseChatFontSize = false
    mockTheme.canIncreaseChatFontSize = false
    mockTheme.chatFontFamily = 'serif'
    mockTheme.isDark = true

    render(<AppearanceSettingsPanel />)

    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sans' }).getAttribute('class')).toContain('outline')
    expect(screen.getByRole('button', { name: 'Serif' }).getAttribute('class')).toContain('secondary')
    expect(screen.getByRole('button', { name: 'Smaller' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Larger' }).hasAttribute('disabled')).toBe(true)
  })
})
