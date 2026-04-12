/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopSettingsDialog } from '@/components/desktop/desktop-settings-dialog'

const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/local',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams('settings=providers'),
}))

vi.mock('@/components/providers/provider-credentials-panel', () => ({
  ProviderCredentialsPanel: () => <div>Providers Panel</div>,
}))

vi.mock('@/components/connectors/connectors-manager', () => ({
  ConnectorsManager: () => <div>Connectors Panel</div>,
}))

vi.mock('@/components/settings/appearance-settings-panel', () => ({
  AppearanceSettingsPanel: () => <div>Appearance Panel</div>,
}))

vi.mock('@/components/settings/agents-settings-panel', () => ({
  AgentsSettingsPanel: () => <div>Agents Panel</div>,
}))

vi.mock('@/components/settings/skills-settings-panel', () => ({
  SkillsSettingsPanel: () => <div>Skills Panel</div>,
}))

vi.mock('@/components/settings/advanced-settings-panel', () => ({
  AdvancedSettingsPanel: () => <div>Advanced Panel</div>,
}))

describe('DesktopSettingsDialog', () => {
  beforeEach(() => {
    replaceMock.mockReset()
  })

  it('renders the active section and switches sections through the query string', () => {
    render(<DesktopSettingsDialog slug="local" currentSection="providers" />)

    expect(screen.getByText('Providers Panel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    expect(replaceMock).toHaveBeenCalledWith('/w/local?settings=connectors')

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(replaceMock).toHaveBeenCalledWith('/w/local?settings=agents')

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    expect(replaceMock).toHaveBeenCalledWith('/w/local?settings=skills')
  })

  it('removes the settings query string when closed', () => {
    render(<DesktopSettingsDialog slug="local" currentSection="providers" />)

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(replaceMock).toHaveBeenCalledWith('/w/local')
  })
})
