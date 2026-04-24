'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  isLinearOAuthScopeAllowedForActor,
  LINEAR_OAUTH_SCOPE_OPTIONS,
  type LinearOAuthActor,
  type LinearOptionalOAuthScope,
} from '@/lib/connectors/linear'

const LINEAR_CREATE_APPLICATION_URL =
  'https://linear.app/settings/api/applications/new'
const LINEAR_ACTOR_AUTH_DOCS_URL =
  'https://linear.app/developers/oauth-actor-authorization'
const LINEAR_CALLBACK_URL_HINT =
  'https://your-arche-host/api/connectors/oauth/callback'

type LinearOAuthFieldsProps = {
  linearOAuthActor: LinearOAuthActor
  onLinearOAuthActorChange: (actor: LinearOAuthActor) => void
  linearOAuthScopes: LinearOptionalOAuthScope[]
  onLinearOAuthScopesChange: (scopes: LinearOptionalOAuthScope[]) => void
}

export function LinearOAuthFields({
  linearOAuthActor,
  onLinearOAuthActorChange,
  linearOAuthScopes,
  onLinearOAuthScopesChange,
}: LinearOAuthFieldsProps) {
  const visibleLinearOAuthScopeOptions = LINEAR_OAUTH_SCOPE_OPTIONS.filter(
    (option) => isLinearOAuthScopeAllowedForActor(option.scope, linearOAuthActor)
  )

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="linear-oauth-actor" className="text-foreground">
          OAuth actor
        </Label>
        <select
          id="linear-oauth-actor"
          className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
          value={linearOAuthActor}
          onChange={(event) =>
            onLinearOAuthActorChange(
              event.target.value === 'app' ? 'app' : 'user'
            )
          }
        >
          <option value="user">User OAuth</option>
          <option value="app">App actor OAuth</option>
        </select>
        <p className="text-xs text-muted-foreground">
          User OAuth acts as the person who connects it. App actor OAuth
          installs your Linear app so mutations appear as the app instead.
        </p>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
        <legend className="px-1 text-sm font-medium text-foreground">
          OAuth permissions
        </legend>
        <p className="text-xs text-muted-foreground">
          Linear always includes <code>read</code>. Select any extra
          permissions you want Arche to request.
        </p>
        <div className="space-y-3">
          {visibleLinearOAuthScopeOptions.map((option) => {
            const inputId = `linear-oauth-scope-${option.scope.replace(/:/g, '-')}`
            const checked = linearOAuthScopes.includes(option.scope)

            return (
              <label
                key={option.scope}
                htmlFor={inputId}
                className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextChecked = event.target.checked
                    onLinearOAuthScopesChange(
                      nextChecked
                        ? linearOAuthScopes.includes(option.scope)
                          ? linearOAuthScopes
                          : [...linearOAuthScopes, option.scope]
                        : linearOAuthScopes.filter(
                            (scope) => scope !== option.scope
                          )
                    )
                  }}
                  className="mt-1 h-4 w-4 rounded border-border text-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}

type LinearAppOAuthFieldsProps = {
  oauthClientId: string
  onOauthClientIdChange: (value: string) => void
  oauthClientSecret: string
  onOauthClientSecretChange: (value: string) => void
}

export function LinearAppOAuthFields({
  oauthClientId,
  onOauthClientIdChange,
  oauthClientSecret,
  onOauthClientSecretChange,
}: LinearAppOAuthFieldsProps) {
  return (
    <>
      <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-sm">
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Create a Linear OAuth application first
          </p>
          <p className="text-muted-foreground">
            Linear app actor mode uses your OAuth application name and icon as
            the author in Linear. A workspace admin must complete the OAuth
            connection.
          </p>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open Linear Settings -&gt; API -&gt; Applications.</li>
          <li>
            Create a new OAuth2 application for Arche with the name and icon
            you want to appear in Linear.
          </li>
          <li>
            Add <code>{LINEAR_CALLBACK_URL_HINT}</code> as a callback URL,
            replacing the host with your Arche URL.
          </li>
          <li>
            Paste the Linear client ID and client secret below before starting
            OAuth.
          </li>
          <li>
            Save this connector, then connect OAuth as a Linear workspace
            admin.
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a
            href={LINEAR_CREATE_APPLICATION_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Create Linear OAuth application
          </a>
          <a
            href={LINEAR_ACTOR_AUTH_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Open Linear actor auth docs
          </a>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="linear-oauth-client-id" className="text-foreground">
          Client ID
        </Label>
        <Input
          id="linear-oauth-client-id"
          value={oauthClientId}
          onChange={(event) => onOauthClientIdChange(event.target.value)}
          placeholder="Linear OAuth client id"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="linear-oauth-client-secret"
          className="text-foreground"
        >
          Client secret
        </Label>
        <Input
          id="linear-oauth-client-secret"
          type="password"
          value={oauthClientSecret}
          onChange={(event) => onOauthClientSecretChange(event.target.value)}
          placeholder="Linear OAuth client secret"
        />
        <p className="text-xs text-muted-foreground">
          Linear app actor mode uses the credentials stored on this connector
          only.
        </p>
      </div>
    </>
  )
}
