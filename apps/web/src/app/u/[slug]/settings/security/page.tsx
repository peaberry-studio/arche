import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ThemePicker } from '@/components/dashboard/theme-picker'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import { get2FAStatus } from './actions'

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params

  const session = await getSession()
  if (!session) redirect('/login')

  const caps = getRuntimeCapabilities()
  const status = caps.twoFactor ? await get2FAStatus() : null
  if (caps.twoFactor && (!status || !status.ok)) redirect('/login')

  const enabled = status?.enabled ?? false
  const verifiedAt = status?.verifiedAt ?? null
  const recoveryCodesRemaining = status?.recoveryCodesRemaining ?? 0

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            Settings
          </h1>
        </div>

        {/* Appearance section */}
        <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
          <h2 className="text-lg font-medium">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Choose a theme for the dashboard.
          </p>
          <ThemePicker />
        </section>

        <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Two-factor authentication
            </h2>
            <Badge variant={caps.twoFactor ? (enabled ? 'default' : 'secondary') : 'outline'}>
              {caps.twoFactor ? (enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}
            </Badge>
          </div>

          {caps.twoFactor ? (
            enabled ? (
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
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Desktop mode signs in with the local workspace automatically, so 2FA is not available here.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
