'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CustomConnectorFieldsProps = {
  authType: 'manual' | 'oauth'
  endpoint: string
  onEndpointChange: (value: string) => void
  auth: string
  onAuthChange: (value: string) => void
  headersText: string
  onHeadersTextChange: (value: string) => void
  oauthScope: string
  onOauthScopeChange: (value: string) => void
  oauthClientId: string
  onOauthClientIdChange: (value: string) => void
  oauthClientSecret: string
  onOauthClientSecretChange: (value: string) => void
  oauthAuthorizationEndpoint: string
  onOauthAuthorizationEndpointChange: (value: string) => void
  oauthTokenEndpoint: string
  onOauthTokenEndpointChange: (value: string) => void
  oauthRegistrationEndpoint: string
  onOauthRegistrationEndpointChange: (value: string) => void
}

export function CustomConnectorFields({
  authType,
  endpoint,
  onEndpointChange,
  auth,
  onAuthChange,
  headersText,
  onHeadersTextChange,
  oauthScope,
  onOauthScopeChange,
  oauthClientId,
  onOauthClientIdChange,
  oauthClientSecret,
  onOauthClientSecretChange,
  oauthAuthorizationEndpoint,
  onOauthAuthorizationEndpointChange,
  oauthTokenEndpoint,
  onOauthTokenEndpointChange,
  oauthRegistrationEndpoint,
  onOauthRegistrationEndpointChange,
}: CustomConnectorFieldsProps) {
  if (authType === 'manual') {
    return (
      <>
        <div className="space-y-2">
          <Label htmlFor="connector-endpoint" className="text-foreground">
            Endpoint
          </Label>
          <Input
            id="connector-endpoint"
            value={endpoint}
            onChange={(event) => onEndpointChange(event.target.value)}
            placeholder="https://example.com/mcp"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="connector-auth" className="text-foreground">
            Auth token{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="connector-auth"
            type="password"
            value={auth}
            onChange={(event) => onAuthChange(event.target.value)}
            placeholder="Bearer token or API key"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="connector-headers" className="text-foreground">
            Headers{' '}
            <span className="font-normal text-muted-foreground">
              (optional JSON)
            </span>
          </Label>
          <textarea
            id="connector-headers"
            className="min-h-24 w-full rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
            value={headersText}
            onChange={(event) => onHeadersTextChange(event.target.value)}
            placeholder={'{\n  "x-api-key": "value"\n}'}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="connector-endpoint-oauth" className="text-foreground">
          MCP endpoint
        </Label>
        <Input
          id="connector-endpoint-oauth"
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
          placeholder="https://example.com/mcp"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-oauth-scope" className="text-foreground">
          OAuth scope{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="connector-oauth-scope"
          value={oauthScope}
          onChange={(event) => onOauthScopeChange(event.target.value)}
          placeholder="read write"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-oauth-client-id" className="text-foreground">
          Client ID{' '}
          <span className="font-normal text-muted-foreground">
            (optional override)
          </span>
        </Label>
        <Input
          id="connector-oauth-client-id"
          value={oauthClientId}
          onChange={(event) => onOauthClientIdChange(event.target.value)}
          placeholder="oauth client id"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-oauth-client-secret"
          className="text-foreground"
        >
          Client secret{' '}
          <span className="font-normal text-muted-foreground">
            (optional override)
          </span>
        </Label>
        <Input
          id="connector-oauth-client-secret"
          type="password"
          value={oauthClientSecret}
          onChange={(event) => onOauthClientSecretChange(event.target.value)}
          placeholder="oauth client secret"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-oauth-auth-endpoint"
          className="text-foreground"
        >
          Authorization endpoint{' '}
          <span className="font-normal text-muted-foreground">
            (optional override)
          </span>
        </Label>
        <Input
          id="connector-oauth-auth-endpoint"
          value={oauthAuthorizationEndpoint}
          onChange={(event) =>
            onOauthAuthorizationEndpointChange(event.target.value)
          }
          placeholder="https://example.com/authorize"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-oauth-token-endpoint"
          className="text-foreground"
        >
          Token endpoint{' '}
          <span className="font-normal text-muted-foreground">
            (optional override)
          </span>
        </Label>
        <Input
          id="connector-oauth-token-endpoint"
          value={oauthTokenEndpoint}
          onChange={(event) => onOauthTokenEndpointChange(event.target.value)}
          placeholder="https://example.com/token"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="connector-oauth-registration-endpoint"
          className="text-foreground"
        >
          Registration endpoint{' '}
          <span className="font-normal text-muted-foreground">
            (optional override)
          </span>
        </Label>
        <Input
          id="connector-oauth-registration-endpoint"
          value={oauthRegistrationEndpoint}
          onChange={(event) =>
            onOauthRegistrationEndpointChange(event.target.value)
          }
          placeholder="https://example.com/register"
        />
      </div>
    </>
  )
}
