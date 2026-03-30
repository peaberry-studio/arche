import { ChangePasswordForm } from './change-password-form'
import { ThemePicker } from '@/components/dashboard/theme-picker'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type SettingsPageContentProps = {
  passwordChangeEnabled: boolean
  twoFactorEnabled: boolean
  enabled: boolean
  verifiedAt: Date | null
  recoveryCodesRemaining: number
  releaseVersion: string
}

export function SettingsPageContent({
  passwordChangeEnabled,
  twoFactorEnabled,
  enabled,
  verifiedAt,
  recoveryCodesRemaining,
  releaseVersion,
}: SettingsPageContentProps) {
  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <h1 className="type-display text-3xl font-semibold tracking-tight">
            Settings
          </h1>
        </div>

        <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
          <h2 className="text-lg font-medium">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Choose a theme for the dashboard.
          </p>
          <ThemePicker />
        </section>

        {passwordChangeEnabled ? (
          <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">Change password</h2>
              <p className="text-sm text-muted-foreground">
                Update your account password and keep your credentials current.
              </p>
            </div>

            <ChangePasswordForm />
          </section>
        ) : null}

        {twoFactorEnabled ? (
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
        ) : null}

        <p className="pt-6 text-center text-[11px] tracking-wide text-muted-foreground/50">
          Peaberry Studio &middot; Arche {releaseVersion}
        </p>
      </div>
    </main>
  )
}
