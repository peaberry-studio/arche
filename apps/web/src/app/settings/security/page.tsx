import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { SESSION_COOKIE_NAME, getSessionFromToken } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { get2FAStatus } from './actions'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'

export default async function SecuritySettingsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) redirect('/login')

  const session = await getSessionFromToken(token)
  if (!session) redirect('/login')

  const status = await get2FAStatus()
  if (!status.ok) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = status

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <main className="relative mx-auto max-w-2xl px-6 py-16">
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-2">
            <Link
              href={`/u/${session.user.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              &larr; Volver al dashboard
            </Link>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Seguridad
            </h1>
          </div>

          {/* 2FA section */}
          <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">
                Autenticación de dos factores
              </h2>
              <Badge variant={enabled ? 'default' : 'secondary'}>
                {enabled ? 'Activado' : 'Desactivado'}
              </Badge>
            </div>

            {enabled ? (
              <div className="space-y-4">
                {verifiedAt && (
                  <p className="text-sm text-muted-foreground">
                    Activado el{' '}
                    {new Date(verifiedAt).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}

                <p className="text-sm text-muted-foreground">
                  Códigos de recuperación restantes:{' '}
                  <span className="font-medium text-foreground">
                    {recoveryCodesRemaining}
                  </span>
                </p>

                <div className="flex gap-3">
                  <TotpSetupWizard mode="regenerate">
                    <Button variant="outline" size="sm">
                      Regenerar códigos
                    </Button>
                  </TotpSetupWizard>

                  <TotpSetupWizard mode="disable">
                    <Button variant="destructive" size="sm">
                      Desactivar 2FA
                    </Button>
                  </TotpSetupWizard>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Protege tu cuenta con un segundo factor de autenticación usando
                  una app como Google Authenticator o Authy.
                </p>

                <TotpSetupWizard mode="setup">
                  <Button size="sm">Configurar 2FA</Button>
                </TotpSetupWizard>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
