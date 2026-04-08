/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopVaultLauncher } from '@/components/desktop/desktop-vault-launcher'

const createVaultMock = vi.fn()
const listRecentVaultsMock = vi.fn()
const openExistingVaultMock = vi.fn()
const openVaultMock = vi.fn()
const pickVaultParentDirectoryMock = vi.fn()
const quitLauncherProcessMock = vi.fn()

vi.mock('@/lib/runtime/desktop/client', () => ({
  getDesktopPlatform: () => 'darwin',
  getDesktopBridge: () => ({
    createVault: createVaultMock,
    getCurrentVault: vi.fn(),
    listRecentVaults: listRecentVaultsMock,
    openExistingVault: openExistingVaultMock,
    openVault: openVaultMock,
    openVaultLauncher: vi.fn(),
    pickVaultParentDirectory: pickVaultParentDirectoryMock,
    quitLauncherProcess: quitLauncherProcessMock,
  }),
}))

function createDeferredResult() {
  let resolve: (value: { ok: true } | { ok: false; error: string }) => void = () => undefined
  const promise = new Promise<{ ok: true } | { ok: false; error: string }>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

describe('DesktopVaultLauncher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    listRecentVaultsMock.mockResolvedValue([])
    pickVaultParentDirectoryMock.mockResolvedValue('/Users/inaki/Documents')
    quitLauncherProcessMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows creation progress immediately and closes the launcher after success', async () => {
    const deferred = createDeferredResult()
    createVaultMock.mockReturnValue(deferred.promise)

    render(<DesktopVaultLauncher />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose location' }))
      await Promise.resolve()
    })

    expect(screen.getByDisplayValue('/Users/inaki/Documents')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create Vault' }))

    expect(screen.getByRole('heading', { name: 'Creating vault...' })).toBeTruthy()

    await act(async () => {
      deferred.resolve({ ok: true })
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Vault created' })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900)
    })

    expect(quitLauncherProcessMock).toHaveBeenCalledTimes(1)
  })

  it('shows opening progress for an existing vault and clears it on failure', async () => {
    const deferred = createDeferredResult()
    openExistingVaultMock.mockReturnValue(deferred.promise)

    render(<DesktopVaultLauncher />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Existing Vault' }))

    expect(screen.getByRole('heading', { name: 'Opening vault...' })).toBeTruthy()

    await act(async () => {
      deferred.resolve({ ok: false, error: 'invalid_vault' })
      await Promise.resolve()
    })

    expect(screen.getByText('The selected folder is not a valid Arche vault.')).toBeTruthy()

    expect(quitLauncherProcessMock).not.toHaveBeenCalled()
  })
})
