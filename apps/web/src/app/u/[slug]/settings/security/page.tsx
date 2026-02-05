import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, getSessionFromToken } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { get2FAStatus } from './actions'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) redirect('/login')

  const session = await getSessionFromToken(token)
  if (!session) redirect('/login')

  const status = await get2FAStatus()
  if (!status.ok) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = status

  return (
    <main className="relative mx-auto max-w-2xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            Security
          </h1>
        </div>

        {/* 2FA section */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Two-factor authentication
            </h2>
            <Badge variant={enabled ? 'default' : 'secondary'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>

          {enabled ? (
            <div className="space-y-4">
              {verifiedAt && (
                <p className="text-sm text-muted-foreground">
                  Enabled on{' '}
                  {new Date(verifiedAt).toLocaleDateString('en-US', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}

              <p className="text-sm text-muted-foreground">
                Recovery codes remaining:{' '}
                <span className="font-medium text-foreground">
                  {recoveryCodesRemaining}
                </span>
              </p>

              <div className="flex gap-3">
                <TotpSetupWizard mode="regenerate">
                  <Button variant="outline" size="sm">
                    Regenerate codes
                  </Button>
                </TotpSetupWizard>

                <TotpSetupWizard mode="disable">
                  <Button variant="destructive" size="sm">
                    Disable 2FA
                  </Button>
                </TotpSetupWizard>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Protect your account with a second authentication factor using
                an app like Google Authenticator or Authy.
              </p>

              <TotpSetupWizard mode="setup">
                <Button size="sm">Set up 2FA</Button>
              </TotpSetupWizard>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
