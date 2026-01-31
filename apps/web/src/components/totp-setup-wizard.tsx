'use client'

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  initiate2FASetup,
  verify2FASetup,
  disable2FA,
  regenerateRecoveryCodes,
} from '@/app/settings/security/actions'

type Step = 'init' | 'scan' | 'verify' | 'recovery'

interface TotpSetupWizardProps {
  mode: 'setup' | 'disable' | 'regenerate'
  children: React.ReactNode
}

export function TotpSetupWizard({ mode, children }: TotpSetupWizardProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('init')
  const [qrUri, setQrUri] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function reset() {
    setStep('init')
    setQrUri('')
    setSecret('')
    setCode('')
    setPassword('')
    setRecoveryCodes([])
    setError('')
    setLoading(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    setOpen(next)
  }

  async function handleSetupInit() {
    setLoading(true)
    setError('')
    const res = await initiate2FASetup()
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setQrUri(res.qrUri)
    setSecret(res.secret)
    setStep('scan')
  }

  async function handleVerify() {
    setLoading(true)
    setError('')
    const res = await verify2FASetup(code)
    setLoading(false)
    if (!res.ok) {
      setError(res.error === 'Invalid code' ? 'Código incorrecto' : res.error)
      return
    }
    setRecoveryCodes(res.recoveryCodes)
    setStep('recovery')
  }

  async function handleDisable() {
    setLoading(true)
    setError('')
    const res = await disable2FA(password)
    setLoading(false)
    if (!res.ok) {
      setError(res.error === 'Invalid password' ? 'Contraseña incorrecta' : res.error)
      return
    }
    setOpen(false)
    window.location.reload()
  }

  async function handleRegenerate() {
    setLoading(true)
    setError('')
    const res = await regenerateRecoveryCodes()
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRecoveryCodes(res.recoveryCodes)
    setStep('recovery')
  }

  function copyCodes() {
    navigator.clipboard.writeText(recoveryCodes.join('\n'))
  }

  function handleDone() {
    setOpen(false)
    window.location.reload()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {/* ── Setup mode ── */}
        {mode === 'setup' && step === 'init' && (
          <>
            <DialogHeader>
              <DialogTitle>Configurar 2FA</DialogTitle>
              <DialogDescription>
                Añade una capa extra de seguridad a tu cuenta con autenticación
                de dos factores.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handleSetupInit} disabled={loading}>
                {loading ? 'Preparando...' : 'Comenzar'}
              </Button>
            </DialogFooter>
          </>
        )}

        {mode === 'setup' && step === 'scan' && (
          <>
            <DialogHeader>
              <DialogTitle>Escanea el código QR</DialogTitle>
              <DialogDescription>
                Abre tu app de autenticación y escanea este código.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={qrUri} size={200} />
              </div>
              <div className="w-full space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Clave manual
                </Label>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {secret}
                </code>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setStep('verify')}>Continuar</Button>
            </DialogFooter>
          </>
        )}

        {mode === 'setup' && step === 'verify' && (
          <>
            <DialogHeader>
              <DialogTitle>Verificar código</DialogTitle>
              <DialogDescription>
                Introduce el código de 6 dígitos de tu app de autenticación.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleVerify} disabled={loading || code.length !== 6}>
                {loading ? 'Verificando...' : 'Verificar'}
              </Button>
            </DialogFooter>
          </>
        )}

        {(mode === 'setup' || mode === 'regenerate') && step === 'recovery' && (
          <>
            <DialogHeader>
              <DialogTitle>Códigos de recuperación</DialogTitle>
              <DialogDescription>
                Guarda estos códigos en un lugar seguro. Cada código solo puede
                usarse una vez.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 py-4">
              {recoveryCodes.map((c) => (
                <code
                  key={c}
                  className="rounded bg-muted px-2 py-1 text-center text-sm font-mono"
                >
                  {c}
                </code>
              ))}
            </div>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button variant="outline" onClick={copyCodes}>
                Copiar códigos
              </Button>
              <Button onClick={handleDone}>Listo</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Disable mode ── */}
        {mode === 'disable' && step === 'init' && (
          <>
            <DialogHeader>
              <DialogTitle>Desactivar 2FA</DialogTitle>
              <DialogDescription>
                Introduce tu contraseña para confirmar la desactivación.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={loading || !password}
              >
                {loading ? 'Desactivando...' : 'Desactivar 2FA'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Regenerate mode ── */}
        {mode === 'regenerate' && step === 'init' && (
          <>
            <DialogHeader>
              <DialogTitle>Regenerar códigos de recuperación</DialogTitle>
              <DialogDescription>
                Los códigos actuales dejarán de funcionar. Se generarán códigos
                nuevos.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handleRegenerate} disabled={loading}>
                {loading ? 'Regenerando...' : 'Regenerar'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
