'use client'

import { useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface TotpVerifyDialogProps {
  open: boolean
  challengeToken: string
  onSuccess: (user: { id: string; email: string; slug: string }) => void
  onCancel: () => void
}

const errorMessages: Record<string, string> = {
  invalid_code: 'Incorrect code',
  challenge_expired: 'Session expired. Sign in again.',
  invalid_request: 'Invalid request.',
  rate_limited: 'Too many attempts. Try again in a few minutes.',
  unknown: 'Something went wrong. Try again.',
}

export function TotpVerifyDialog({
  open,
  challengeToken,
  onSuccess,
  onCancel,
}: TotpVerifyDialogProps) {
  const [code, setCode] = useState('')
  const [isRecoveryCode, setIsRecoveryCode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleVerify() {
    if (!code.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/auth/verify-2fa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeToken, code: code.trim(), isRecoveryCode }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => null)

      if (data?.ok && data.user) {
        onSuccess(data.user)
      } else {
        setError(errorMessages[data?.error ?? 'unknown'] ?? errorMessages.unknown)
      }
    } catch {
      setError("We couldn't reach the server.")
    } finally {
      setLoading(false)
    }
  }

  function toggleMode() {
    setIsRecoveryCode((v) => !v)
    setCode('')
    setError('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two-factor verification</DialogTitle>
          <DialogDescription>
            {isRecoveryCode
              ? 'Enter a recovery code (format XXXX-XXXX).'
              : 'Enter the 6-digit code from your authenticator app.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <Input
            placeholder={isRecoveryCode ? 'XXXX-XXXX' : '000000'}
            maxLength={isRecoveryCode ? 9 : 6}
            value={code}
            onChange={(e) =>
              setCode(
                isRecoveryCode
                  ? e.target.value.toUpperCase()
                  : e.target.value.replace(/\D/g, '')
              )
            }
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex flex-col gap-3 sm:flex-col">
          <Button
            onClick={handleVerify}
            disabled={loading || !code.trim()}
            className="w-full"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={toggleMode}
          >
            {isRecoveryCode
              ? 'Use app code'
              : "Don't have access? Use a recovery code"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
