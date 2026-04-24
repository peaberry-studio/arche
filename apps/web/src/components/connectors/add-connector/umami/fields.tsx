'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type UmamiConnectorFieldsProps = {
  umamiAuthMethod: 'api-key' | 'login'
  onUmamiAuthMethodChange: (method: 'api-key' | 'login') => void
  umamiBaseUrl: string
  onUmamiBaseUrlChange: (value: string) => void
  umamiApiKey: string
  onUmamiApiKeyChange: (value: string) => void
  umamiUsername: string
  onUmamiUsernameChange: (value: string) => void
  umamiPassword: string
  onUmamiPasswordChange: (value: string) => void
}

export function UmamiConnectorFields({
  umamiAuthMethod,
  onUmamiAuthMethodChange,
  umamiBaseUrl,
  onUmamiBaseUrlChange,
  umamiApiKey,
  onUmamiApiKeyChange,
  umamiUsername,
  onUmamiUsernameChange,
  umamiPassword,
  onUmamiPasswordChange,
}: UmamiConnectorFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="connector-umami-base-url" className="text-foreground">
          Base URL
        </Label>
        <Input
          id="connector-umami-base-url"
          value={umamiBaseUrl}
          onChange={(event) => onUmamiBaseUrlChange(event.target.value)}
          placeholder={
            umamiAuthMethod === 'api-key'
              ? 'https://api.umami.is/v1'
              : 'https://analytics.example.com'
          }
        />
        <p className="text-xs text-muted-foreground">
          Use the public HTTPS API base. For Umami Cloud the default is{' '}
          <code>https://api.umami.is/v1</code>. For self-hosted Umami you can
          enter the site root and Arche will use <code>/api</code>{' '}
          automatically.
        </p>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-umami-auth-method"
          className="text-foreground"
        >
          Authentication method
        </Label>
        <select
          id="connector-umami-auth-method"
          className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
          value={umamiAuthMethod}
          onChange={(event) =>
            onUmamiAuthMethodChange(
              event.target.value === 'login' ? 'login' : 'api-key'
            )
          }
        >
          <option value="api-key">Umami Cloud API key</option>
          <option value="login">Self-hosted username/password</option>
        </select>
      </div>

      {umamiAuthMethod === 'api-key' ? (
        <>
          <div className="space-y-2">
            <Label
              htmlFor="connector-umami-api-key"
              className="text-foreground"
            >
              API key
            </Label>
            <Input
              id="connector-umami-api-key"
              type="password"
              value={umamiApiKey}
              onChange={(event) => onUmamiApiKeyChange(event.target.value)}
              placeholder="Paste your Umami Cloud API key"
            />
          </div>
          <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Supported reads: websites, summary stats, pageview series, ranked
            metrics, recent sessions, recent events, and realtime. Umami Cloud
            API keys are rate-limited to 50 requests every 15 seconds.
          </p>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label
              htmlFor="connector-umami-username"
              className="text-foreground"
            >
              Username
            </Label>
            <Input
              id="connector-umami-username"
              value={umamiUsername}
              onChange={(event) => onUmamiUsernameChange(event.target.value)}
              placeholder="admin"
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="connector-umami-password"
              className="text-foreground"
            >
              Password
            </Label>
            <Input
              id="connector-umami-password"
              type="password"
              value={umamiPassword}
              onChange={(event) => onUmamiPasswordChange(event.target.value)}
              placeholder="Paste your Umami password"
            />
          </div>

          <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            The configured user needs permission to read the target websites in
            Umami. Arche only exposes read-only analytics tools for this
            connector.
          </p>
        </>
      )}
    </>
  )
}
