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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        agents: [
          {
            id: 'assistant',
            displayName: 'Assistant',
            description: 'Primary assistant',
            systemPrompt: 'help the user',
            recommendedModel: 'openai/gpt-5',
            temperature: 0.2,
            tools: ['read'],
          },
          {
            id: 'knowledge-curator',
            displayName: 'Knowledge Curator',
            description: 'Maintains the KB',
            systemPrompt: 'curate knowledge carefully',
            recommendedModel: 'openai/gpt-5',
            temperature: 0.2,
            tools: ['read'],
          },
        ],
        models: [],
        templates: [
          {
            id: 'blank',
            label: 'Blank',
            description: 'Minimal template',
            recommendedAgentIds: ['assistant', 'knowledge-curator'],
            agentOverrides: {},
          },
        ],
      }),
    }))
    listRecentVaultsMock.mockResolvedValue([])
    pickVaultParentDirectoryMock.mockResolvedValue('/Users/inaki/Documents')
    quitLauncherProcessMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows creation progress immediately and closes the launcher after success', async () => {
    const deferred = createDeferredResult()
    createVaultMock.mockReturnValue(deferred.promise)

    render(<DesktopVaultLauncher />)

    fireEvent.click(await screen.findByRole('button', { name: /Create new vault/i }))

    expect(await screen.findByDisplayValue('my-vault')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Vault details' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose location' }))
      await Promise.resolve()
    })

    expect(screen.getByDisplayValue('/Users/inaki/Documents')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Acme' },
    })
    fireEvent.change(screen.getByLabelText('Short description'), {
      target: { value: 'Internal AI workspace' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Template selection' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Agent selection' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review and apply' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }))

    expect(createVaultMock).toHaveBeenCalledWith({
      kickstartPayload: {
        agents: [
          {
            id: 'assistant',
            model: 'openai/gpt-5',
            prompt: 'help the user',
            temperature: 0.2,
          },
          {
            id: 'knowledge-curator',
            model: 'openai/gpt-5',
            prompt: 'curate knowledge carefully',
            temperature: 0.2,
          },
        ],
        companyDescription: 'Internal AI workspace',
        companyName: 'Acme',
        templateId: 'blank',
      },
      parentPath: '/Users/inaki/Documents',
      name: 'my-vault',
    })

    expect(screen.getByRole('heading', { name: 'Creating vault...' })).toBeTruthy()

    vi.useFakeTimers()

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

    expect(await screen.findByRole('button', { name: /Open existing vault/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Open existing vault/i }))

    expect(screen.getByRole('heading', { name: 'Opening vault...' })).toBeTruthy()

    await act(async () => {
      deferred.resolve({ ok: false, error: 'invalid_vault' })
      await Promise.resolve()
    })

    expect(screen.getByText('The selected folder is not a valid Arche vault.')).toBeTruthy()

    expect(quitLauncherProcessMock).not.toHaveBeenCalled()
  })
})
