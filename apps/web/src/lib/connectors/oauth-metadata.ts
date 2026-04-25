import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

export type OAuthServerMetadata = {
  issuer?: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function validateConnectorUrl(rawUrl: string): Promise<string> {
  const validation = await validateConnectorTestEndpoint(rawUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  return validation.url.toString()
}

export async function sanitizeOAuthMetadata(metadata: OAuthServerMetadata): Promise<OAuthServerMetadata> {
  return {
    issuer: metadata.issuer,
    authorizationEndpoint: await validateConnectorUrl(metadata.authorizationEndpoint),
    tokenEndpoint: await validateConnectorUrl(metadata.tokenEndpoint),
    registrationEndpoint: metadata.registrationEndpoint
      ? await validateConnectorUrl(metadata.registrationEndpoint)
      : undefined,
  }
}

export async function discoverOAuthMetadata(mcpServerUrl: string): Promise<OAuthServerMetadata> {
  const serverUrl = new URL(mcpServerUrl)
  const authorizationBase = `${serverUrl.protocol}//${serverUrl.host}`
  const metadataUrl = `${authorizationBase}/.well-known/oauth-authorization-server`

  const metadataResponse = await fetch(metadataUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  }).catch(() => null)

  if (metadataResponse && metadataResponse.ok) {
    const data = (await metadataResponse.json().catch(() => null)) as Record<string, unknown> | null
    const authorizationEndpoint = getString(data?.authorization_endpoint)
    const tokenEndpoint = getString(data?.token_endpoint)
    if (!authorizationEndpoint || !tokenEndpoint) {
      throw new Error('oauth_discovery_failed:invalid_metadata')
    }

    return {
      issuer: getString(data?.issuer),
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint: getString(data?.registration_endpoint),
    }
  }

  if (metadataResponse && metadataResponse.status !== 404) {
    throw new Error(`oauth_discovery_failed:${metadataResponse.status}`)
  }

  return {
    authorizationEndpoint: `${authorizationBase}/authorize`,
    tokenEndpoint: `${authorizationBase}/token`,
    registrationEndpoint: `${authorizationBase}/register`,
  }
}
