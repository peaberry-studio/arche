'use client'

import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { changePassword } from './actions'

type FeedbackState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; message: string }

const IDLE_FEEDBACK: FeedbackState = { kind: 'idle' }

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [feedback, setFeedback] = useState<FeedbackState>(IDLE_FEEDBACK)
  const [loading, setLoading] = useState(false)

  function resetForm() {
    setCurrentPassword('')
    setNewPassword('')
    setNewPasswordConfirmation('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setFeedback(IDLE_FEEDBACK)

    try {
      const result = await changePassword(
        currentPassword,
        newPassword,
        newPasswordConfirmation,
      )

      if (!result.ok) {
        setFeedback({ kind: 'error', message: result.message })
        return
      }

      resetForm()
      setFeedback({ kind: 'success', message: 'Password changed successfully.' })
    } catch {
      setFeedback({
        kind: 'error',
        message: 'Something went wrong while changing your password. Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-password-confirmation">Confirm new password</Label>
        <Input
          id="new-password-confirmation"
          type="password"
          autoComplete="new-password"
          value={newPasswordConfirmation}
          onChange={(event) => setNewPasswordConfirmation(event.target.value)}
        />
      </div>

      {feedback.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {feedback.message}
        </p>
      ) : null}

      {feedback.kind === 'success' ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800"
        >
          {feedback.message}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={loading || !currentPassword || !newPassword || !newPasswordConfirmation}
      >
        {loading ? 'Changing password...' : 'Change password'}
      </Button>
    </form>
  )
}
