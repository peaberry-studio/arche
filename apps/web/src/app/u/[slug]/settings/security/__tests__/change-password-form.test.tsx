/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockChangePassword = vi.fn()
vi.mock('../actions', () => ({
  changePassword: (currentPassword: string, newPassword: string, newPasswordConfirmation: string) =>
    mockChangePassword(currentPassword, newPassword, newPasswordConfirmation),
}))

import { ChangePasswordForm } from '../change-password-form'

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('submits the entered passwords and shows a server-side error message', async () => {
    mockChangePassword.mockResolvedValue({
      ok: false,
      error: 'invalid_current_password',
      message: 'Current password is incorrect',
    })

    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith(
        'wrong-password',
        'new-password-123',
        'new-password-123',
      )
    })

    expect(await screen.findByText('Current password is incorrect')).toBeTruthy()
  })

  it('shows success feedback and clears the form on success', async () => {
    mockChangePassword.mockResolvedValue({ ok: true })

    render(<ChangePasswordForm />)

    const currentPasswordInput = screen.getByLabelText('Current password') as HTMLInputElement
    const newPasswordInput = screen.getByLabelText('New password') as HTMLInputElement
    const confirmationInput = screen.getByLabelText('Confirm new password') as HTMLInputElement

    fireEvent.change(currentPasswordInput, {
      target: { value: 'current-password' },
    })
    fireEvent.change(newPasswordInput, {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(confirmationInput, {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password changed successfully.')).toBeTruthy()
    expect(currentPasswordInput.value).toBe('')
    expect(newPasswordInput.value).toBe('')
    expect(confirmationInput.value).toBe('')
  })

  it('shows a generic error and re-enables submit if the action throws', async () => {
    mockChangePassword.mockRejectedValue(new Error('db down'))

    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-password-123' },
    })

    const submitButton = screen.getByRole('button', { name: 'Change password' })
    fireEvent.click(submitButton)

    expect(
      await screen.findByText('Something went wrong while changing your password. Please try again.'),
    ).toBeTruthy()
    await waitFor(() => {
      expect(submitButton.getAttribute('disabled')).toBeNull()
    })
  })
})
