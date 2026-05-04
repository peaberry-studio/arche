/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KickstartPage from '@/app/u/[slug]/kickstart/page'

type WebKickstartWizardProps = {
  initialCompanyName: string
  initialStatus: string
  slug: string
}

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))
const getSessionMock = vi.hoisted(() => vi.fn())
const getCurrentDesktopVaultMock = vi.hoisted(() => vi.fn())
const isDesktopMock = vi.hoisted(() => vi.fn())
const getKickstartStatusMock = vi.hoisted(() => vi.fn())
const wizardProps = vi.hoisted(() => ({ current: null as WebKickstartWizardProps | null }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

vi.mock('@/components/kickstart/web-kickstart-wizard', () => ({
  WebKickstartWizard: (props: WebKickstartWizardProps) => {
    wizardProps.current = props
    return <div>Kickstart wizard for {props.slug}</div>
  },
}))

vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: () => getKickstartStatusMock(),
}))

vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: () => getCurrentDesktopVaultMock(),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => isDesktopMock(),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => getSessionMock(),
}))

function renderKickstartPage(slug = 'alice') {
  return KickstartPage({ params: Promise.resolve({ slug }) })
}

describe('KickstartPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wizardProps.current = null
    isDesktopMock.mockReturnValue(false)
    getCurrentDesktopVaultMock.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ user: { role: 'ADMIN', slug: 'alice' } })
    getKickstartStatusMock.mockResolvedValue('needs_setup')
  })

  it('redirects unauthenticated users to login', async () => {
    getSessionMock.mockResolvedValue(null)

    await expect(renderKickstartPage()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects non-admin owners to the admin-required setup notice', async () => {
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'alice' } })

    await expect(renderKickstartPage()).rejects.toThrow('REDIRECT:/u/alice?setup=admin-required')
  })

  it('redirects non-admin users away from other workspaces', async () => {
    getSessionMock.mockResolvedValue({ user: { role: 'USER', slug: 'bob' } })

    await expect(renderKickstartPage()).rejects.toThrow('REDIRECT:/u/bob')
  })

  it('redirects when kickstart is already ready', async () => {
    getKickstartStatusMock.mockResolvedValue('ready')

    await expect(renderKickstartPage()).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects desktop mode when no vault is selected', async () => {
    isDesktopMock.mockReturnValue(true)

    await expect(renderKickstartPage()).rejects.toThrow('REDIRECT:/')
  })

  it('renders the wizard with the desktop vault name when setup is pending', async () => {
    isDesktopMock.mockReturnValue(true)
    getCurrentDesktopVaultMock.mockReturnValue({ vaultName: 'Client Vault' })

    render(await renderKickstartPage())

    expect(screen.getByRole('heading', { name: 'Initial workspace setup' })).toBeTruthy()
    expect(screen.getByText('Kickstart wizard for alice')).toBeTruthy()
    expect(wizardProps.current).toMatchObject({
      initialCompanyName: 'Client Vault',
      initialStatus: 'needs_setup',
      slug: 'alice',
    })
  })
})
