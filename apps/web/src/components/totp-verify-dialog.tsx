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
  invalid_code: 'Código incorrecto',
  challenge_expired: 'Tiempo expirado. Inicia sesión de nuevo.',
  invalid_request: 'Solicitud inválida.',
  rate_limited: 'Demasiados intentos. Intenta de nuevo en unos minutos.',
  unknown: 'Algo salió mal. Intenta de nuevo.',
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
      setError('No pudimos conectar con el servidor.')
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
          <DialogTitle>Verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {isRecoveryCode
              ? 'Introduce un código de recuperación (formato XXXX-XXXX).'
              : 'Introduce el código de 6 dígitos de tu app de autenticación.'}
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
            {loading ? 'Verificando...' : 'Verificar'}
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={toggleMode}
          >
            {isRecoveryCode
              ? 'Usar código de la app'
              : '¿No tienes acceso? Usa un código de recuperación'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
