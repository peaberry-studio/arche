/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  disable2FA,
  initiate2FASetup,
  regenerateRecoveryCodes,
  verify2FASetup,
} from '@/app/u/[slug]/settings/security/actions'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr-code" data-value={value} />,
}))

vi.mock('@/app/u/[slug]/settings/security/actions', () => ({
  disable2FA: vi.fn(),
  initiate2FASetup: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  verify2FASetup: vi.fn(),
}))

const clipboardWriteMock = vi.fn()

function openWizard(mode: 'setup' | 'disable' | 'regenerate') {
  render(
    <TotpSetupWizard mode={mode}>
      <button type="button">Open wizard</button>
    </TotpSetupWizard>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open wizard' }))
}

describe('TotpSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipboardWriteMock.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('walks through setup and copies recovery codes', async () => {
    vi.mocked(initiate2FASetup).mockResolvedValue({
      ok: true,
      qrUri: 'otpauth://totp/arche',
      secret: 'SECRET123',
    })
    vi.mocked(verify2FASetup).mockResolvedValue({
      ok: true,
      recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'],
    })

    openWizard('setup')

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(await screen.findByText('Scan the QR code')).toBeTruthy()
    expect(screen.getByTestId('qr-code').getAttribute('data-value')).toBe('otpauth://totp/arche')
    expect(screen.getByText('SECRET123')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const codeInput = screen.getByPlaceholderText('000000') as HTMLInputElement
    fireEvent.change(codeInput, { target: { value: '12a3456' } })
    expect(codeInput.value).toBe('123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('Recovery codes')).toBeTruthy()
    expect(screen.getByText('AAAA-BBBB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }))

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith('AAAA-BBBB\nCCCC-DDDD')
    })
  })

  it('maps setup and disable validation errors', async () => {
    vi.mocked(initiate2FASetup).mockResolvedValue({ ok: false, error: 'setup_failed' })
    vi.mocked(disable2FA).mockResolvedValue({ ok: false, error: 'Invalid password' })

    openWizard('setup')
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('setup_failed')).toBeTruthy()

    cleanup()
    openWizard('disable')
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'bad-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }))

    expect(await screen.findByText('Incorrect password')).toBeTruthy()
    expect(disable2FA).toHaveBeenCalledWith('bad-password')
  })

  it('maps invalid setup verification codes to a friendly error', async () => {
    vi.mocked(initiate2FASetup).mockResolvedValue({
      ok: true,
      qrUri: 'otpauth://totp/arche',
      secret: 'SECRET123',
    })
    vi.mocked(verify2FASetup).mockResolvedValue({ ok: false, error: 'Invalid code' })

    openWizard('setup')
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Scan the QR code')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('Incorrect code')).toBeTruthy()
  })

  it('regenerates recovery codes after password confirmation', async () => {
    vi.mocked(regenerateRecoveryCodes).mockResolvedValue({
      ok: true,
      recoveryCodes: ['EEEE-FFFF'],
    })

    openWizard('regenerate')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByText('EEEE-FFFF')).toBeTruthy()
    expect(regenerateRecoveryCodes).toHaveBeenCalledWith('current-password')
  })

  it('opens recovery codes in a popup when clipboard is unavailable', async () => {
    const write = vi.fn()
    vi.mocked(regenerateRecoveryCodes).mockResolvedValue({
      ok: true,
      recoveryCodes: ['GGGG-HHHH'],
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write,
        title: '',
      },
    } as unknown as Window)

    openWizard('regenerate')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText('GGGG-HHHH')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }))

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith('<pre style="font-size:16px;padding:20px">GGGG-HHHH</pre>')
    })
  })
})
