/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LoginPage from '@/app/login/page'

type TotpVerifyDialogProps = {
  challengeToken: string
  onCancel: () => void
  onSuccess: (user: { email: string; id: string; slug: string }) => void
  open: boolean
}

const pushMock = vi.hoisted(() => vi.fn())
const totpProps = vi.hoisted(() => ({ current: undefined as TotpVerifyDialogProps | undefined }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/components/totp-verify-dialog', () => ({
  TotpVerifyDialog: (props: TotpVerifyDialogProps) => {
    totpProps.current = props
    return props.open ? (
      <button
        type="button"
        onClick={() => props.onSuccess({ id: 'user-1', email: 'alice@example.com', slug: 'alice' })}
      >
        Complete 2FA
      </button>
    ) : null
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    pushMock.mockReset()
    totpProps.current = undefined
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('submits normalized credentials and redirects after login', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      ok: true,
      user: { id: 'user-1', email: 'alice@example.com', slug: 'alice', role: 'ADMIN' },
    }))

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Alice@Example.COM ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', password: 'password' }),
        credentials: 'include',
      })
    })
    expect(await screen.findByText('alice@example.com')).toBeTruthy()

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/u/alice')
    })
  })

  it('handles invalid credentials and 2FA challenges', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'invalid_credentials' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true, requires2FA: true, challengeToken: 'challenge-1' }))

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('button', { name: 'Complete 2FA' })).toBeTruthy()
    expect(totpProps.current?.challengeToken).toBe('challenge-1')

    fireEvent.click(screen.getByRole('button', { name: 'Complete 2FA' }))
    expect(await screen.findByText('alice@example.com')).toBeTruthy()
  })
})
