import { ChangePasswordForm } from './change-password-form'
import { SettingsInfoBox } from '@/components/settings/settings-info-box'
import { SettingsSection } from '@/components/settings/settings-section'
import { TotpSetupWizard } from '@/components/totp-setup-wizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type SecuritySettingsPanelProps = {
  passwordChangeEnabled: boolean
  twoFactorEnabled: boolean
  enabled: boolean
  verifiedAt: Date | null
  recoveryCodesRemaining: number
}

export function SecuritySettingsPanel({
  passwordChangeEnabled,
  twoFactorEnabled,
  enabled,
  verifiedAt,
  recoveryCodesRemaining,
}: SecuritySettingsPanelProps) {
  return (
    <div className="space-y-6">
      {passwordChangeEnabled ? (
        <SettingsSection
          headingLevel="h3"
          title="Change password"
          description="Update your account password and keep your credentials current."
        >
          <ChangePasswordForm />
        </SettingsSection>
      ) : null}

      {twoFactorEnabled ? (
        <SettingsSection
          headingLevel="h3"
          title="Two-factor authentication"
          action={
            <Badge variant={enabled ? 'default' : 'secondary'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          }
        >
          {enabled ? (
            <div className="space-y-4">
              <SettingsInfoBox tone="info">
                {verifiedAt && (
                  <p>
                    Enabled on{' '}
                    {new Date(verifiedAt).toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
                <p className={verifiedAt ? 'mt-1' : undefined}>
                  Recovery codes remaining:{' '}
                  <span className="font-medium text-foreground">{recoveryCodesRemaining}</span>
                </p>
              </SettingsInfoBox>

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
                Protect your account with a second authentication factor using an app
                like Google Authenticator or Authy.
              </p>

              <TotpSetupWizard mode="setup">
                <Button size="sm">Set up 2FA</Button>
              </TotpSetupWizard>
            </div>
          )}
        </SettingsSection>
      ) : null}
    </div>
  )
}
