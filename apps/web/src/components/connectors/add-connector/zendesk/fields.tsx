'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ZendeskConnectorFieldsProps = {
  zendeskSubdomain: string
  onZendeskSubdomainChange: (value: string) => void
  zendeskEmail: string
  onZendeskEmailChange: (value: string) => void
  apiToken: string
  onApiTokenChange: (value: string) => void
}

export function ZendeskConnectorFields({
  zendeskSubdomain,
  onZendeskSubdomainChange,
  zendeskEmail,
  onZendeskEmailChange,
  apiToken,
  onApiTokenChange,
}: ZendeskConnectorFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label
          htmlFor="connector-zendesk-subdomain"
          className="text-foreground"
        >
          Zendesk subdomain
        </Label>
        <Input
          id="connector-zendesk-subdomain"
          value={zendeskSubdomain}
          onChange={(event) => onZendeskSubdomainChange(event.target.value)}
          placeholder="acme"
        />
        <p className="text-xs text-muted-foreground">
          Enter the account subdomain, for example <code>acme</code> for{' '}
          <code>acme.zendesk.com</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-zendesk-email" className="text-foreground">
          Agent email
        </Label>
        <Input
          id="connector-zendesk-email"
          type="email"
          value={zendeskEmail}
          onChange={(event) => onZendeskEmailChange(event.target.value)}
          placeholder="agent@example.com"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-zendesk-api-token"
          className="text-foreground"
        >
          API token
        </Label>
        <Input
          id="connector-zendesk-api-token"
          type="password"
          value={apiToken}
          onChange={(event) => onApiTokenChange(event.target.value)}
          placeholder="Paste your Zendesk API token"
        />
      </div>
    </>
  )
}
