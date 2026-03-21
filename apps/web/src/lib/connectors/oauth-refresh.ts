import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { buildConfigWithOAuth, getConnectorAuthType, getConnectorOAuthConfig, isOAuthTokenExpiringSoon } from '@/lib/connectors/oauth-config'
import { isOAuthConnectorType, refreshConnectorOAuthToken } from '@/lib/connectors/oauth'
import { validateConnectorType } from '@/lib/connectors/validators'

type ConnectorRefreshRecord = {
  id: string
  type: string
  config: string
}

export async function refreshConnectorOAuthConfigIfNeeded(
  connector: ConnectorRefreshRecord
): Promise<string | null> {
  if (!validateConnectorType(connector.type) || !isOAuthConnectorType(connector.type)) return null

  let decrypted: Record<string, unknown>
  try {
    decrypted = decryptConfig(connector.config)
  } catch {
    return null
  }

  if (getConnectorAuthType(decrypted) !== 'oauth') {
    return null
  }

  const oauth = getConnectorOAuthConfig(connector.type, decrypted)
  if (!oauth) return null
  if (!oauth.refreshToken || !isOAuthTokenExpiringSoon(oauth)) {
    return null
  }

  try {
    const refreshed = await refreshConnectorOAuthToken({
      connectorType: connector.type,
      refreshToken: oauth.refreshToken,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      tokenEndpoint: oauth.tokenEndpoint,
    })

    const nextConfig = buildConfigWithOAuth({
      connectorType: connector.type,
      currentConfig: decrypted,
      oauth: {
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        tokenEndpoint: oauth.tokenEndpoint,
        authorizationEndpoint: oauth.authorizationEndpoint,
        registrationEndpoint: oauth.registrationEndpoint,
        issuer: oauth.issuer,
        mcpServerUrl: oauth.mcpServerUrl,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? oauth.refreshToken,
        tokenType: refreshed.tokenType ?? oauth.tokenType,
        scope: refreshed.scope ?? oauth.scope,
        expiresAt: refreshed.expiresAt,
      },
    })

    const encrypted = encryptConfig(nextConfig)
    const { connectorService } = await import('@/lib/services')
    await connectorService.updateByIdUnsafe(connector.id, { config: encrypted })

    return encrypted
  } catch {
    return null
  }
}
