'use client'

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import {
  disable2FA,
  initiate2FASetup,
  regenerateRecoveryCodes,
  verify2FASetup,
} from '@/app/u/[slug]/settings/security/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyTextToClipboard } from '@/lib/clipboard'

type Step = 'init' | 'scan' | 'verify' | 'recovery'

type TotpSetupWizardProps = {
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
  const [copied, setCopied] = useState(false)

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
      setError(res.error === 'Invalid code' ? 'Incorrect code' : res.error)
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
      setError(res.error === 'Invalid password' ? 'Incorrect password' : res.error)
      return
    }
    setOpen(false)
    window.location.reload()
  }

  async function handleRegenerate() {
    setLoading(true)
    setError('')
    const res = await regenerateRecoveryCodes(password)
    setLoading(false)
    if (!res.ok) {
      setError(res.error === 'Invalid password' ? 'Incorrect password' : res.error)
      return
    }
    setRecoveryCodes(res.recoveryCodes)
    setStep('recovery')
  }

  async function copyCodes() {
    const text = recoveryCodes.join('\n')

    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return
    }

    const w = window.open('', '_blank', 'width=400,height=300')
    if (w) {
      w.document.write(`<pre style="font-size:16px;padding:20px">${text}</pre>`)
      w.document.title = 'Recovery codes - Select and copy'
    }
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
              <DialogTitle>Set up 2FA</DialogTitle>
              <DialogDescription>
                Add an extra layer of security to your account with two-factor
                authentication.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handleSetupInit} disabled={loading}>
                {loading ? 'Preparing...' : 'Start'}
              </Button>
            </DialogFooter>
          </>
        )}

        {mode === 'setup' && step === 'scan' && (
          <>
            <DialogHeader>
              <DialogTitle>Scan the QR code</DialogTitle>
              <DialogDescription>
                Open your authenticator app and scan this code.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={qrUri} size={200} />
              </div>
              <div className="w-full space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Manual key
                </Label>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {secret}
                </code>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setStep('verify')}>Continue</Button>
            </DialogFooter>
          </>
        )}

        {mode === 'setup' && step === 'verify' && (
          <>
            <DialogHeader>
              <DialogTitle>Verify code</DialogTitle>
              <DialogDescription>
                Enter the 6-digit code from your authenticator app.
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
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
            </DialogFooter>
          </>
        )}

        {(mode === 'setup' || mode === 'regenerate') && step === 'recovery' && (
          <>
            <DialogHeader>
              <DialogTitle>Recovery codes</DialogTitle>
              <DialogDescription>
                Store these codes in a safe place. Each code can be used once.
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
                {copied ? 'Copied!' : 'Copy codes'}
              </Button>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Disable mode ── */}
        {mode === 'disable' && step === 'init' && (
          <>
            <DialogHeader>
              <DialogTitle>Disable 2FA</DialogTitle>
              <DialogDescription>
                Enter your password to confirm disabling 2FA.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <Input
                type="password"
                placeholder="Password"
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
                {loading ? 'Disabling...' : 'Disable 2FA'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Regenerate mode ── */}
        {mode === 'regenerate' && step === 'init' && (
          <>
            <DialogHeader>
              <DialogTitle>Regenerate recovery codes</DialogTitle>
              <DialogDescription>
                Current codes will stop working. New codes will be generated.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <label htmlFor="regen-password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="regen-password"
                type="password"
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>
            <DialogFooter>
              <Button onClick={handleRegenerate} disabled={loading || !password}>
                {loading ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
