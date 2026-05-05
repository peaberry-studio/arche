/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EditAutopilotPage from '@/app/u/[slug]/autopilot/[id]/page'

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const getRuntimeCapabilitiesMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/autopilot/autopilot-task-form', () => ({
  AutopilotTaskForm: ({ mode, slug, taskId }: { mode: string; slug: string; taskId?: string }) => (
    <div>Autopilot task form {mode} {slug} {taskId}</div>
  ),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => getRuntimeCapabilitiesMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

function renderEditAutopilotPage() {
  return EditAutopilotPage({ params: Promise.resolve({ id: 'task-1', slug: 'alice' }) })
}

describe('EditAutopilotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getRuntimeCapabilitiesMock.mockReturnValue({ autopilot: true })
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderEditAutopilotPage()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects desktop mode back to the dashboard when a vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultName: 'Client Vault' })

    await expect(renderEditAutopilotPage()).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects when autopilot capability is disabled', async () => {
    getRuntimeCapabilitiesMock.mockReturnValue({ autopilot: false })

    await expect(renderEditAutopilotPage()).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('renders the edit form when autopilot is available', async () => {
    render(await renderEditAutopilotPage())

    expect(screen.getByRole('heading', { name: 'Edit autopilot task' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to autopilot/ }).getAttribute('href')).toBe('/u/alice/autopilot')
    expect(screen.getByText('Autopilot task form edit alice task-1')).toBeTruthy()
  })
})
