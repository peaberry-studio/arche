import { decryptProviderSecret } from '@/lib/providers/crypto'
import {
  createOllamaProviderSecret,
  isOllamaSecret,
  refreshOllamaProviderSecret,
  type OllamaDiscoveryError,
} from '@/lib/providers/ollama'
import type { OllamaSecret, ProviderId } from '@/lib/providers/types'

export type OllamaCredentialRequestBody = {
  apiKey?: string
  baseUrl?: string
  mode?: string
  refresh?: boolean
  token?: string
}

type EncryptedProviderCredential = {
  secret: string
}

export type OllamaCredentialRequestError = {
  error: string
  message?: string
  status: number
}

export type OllamaCredentialRequestResult =
  | { ok: true; secret: OllamaSecret }
  | { ok: false; response: OllamaCredentialRequestError }

function getOllamaDiscoveryError(error: OllamaDiscoveryError): OllamaCredentialRequestError {
  if (error === 'invalid_url') {
    return { error: 'invalid_endpoint', status: 400 }
  }

  if (error === 'blocked_url') {
    return { error: 'blocked_endpoint', status: 400 }
  }

  if (error === 'missing_token') {
    return { error: 'missing_fields', status: 400 }
  }

  return { error: 'ollama_discovery_failed', status: 400 }
}

async function getRefreshedOllamaSecret(input: {
  getExistingCredential: (providerId: ProviderId) => Promise<EncryptedProviderCredential | null>
  providerId: ProviderId
}): Promise<OllamaCredentialRequestResult> {
  const existing = await input.getExistingCredential(input.providerId)
  if (!existing) {
    return { ok: false, response: { error: 'missing_credential', status: 404 } }
  }

  let secret: unknown
  try {
    secret = decryptProviderSecret(existing.secret)
  } catch {
    return { ok: false, response: { error: 'invalid_credentials', status: 500 } }
  }

  if (!isOllamaSecret(secret)) {
    return { ok: false, response: { error: 'unsupported_credential', status: 501 } }
  }

  const refreshed = await refreshOllamaProviderSecret(secret)
  if (!refreshed.ok) {
    return { ok: false, response: getOllamaDiscoveryError(refreshed.error) }
  }

  return { ok: true, secret: refreshed.secret }
}

export async function getOllamaSecretFromRequest(input: {
  body: OllamaCredentialRequestBody
  getExistingCredential: (providerId: ProviderId) => Promise<EncryptedProviderCredential | null>
  providerId: ProviderId
}): Promise<OllamaCredentialRequestResult> {
  if (input.body.refresh === true) {
    return getRefreshedOllamaSecret({
      getExistingCredential: input.getExistingCredential,
      providerId: input.providerId,
    })
  }

  if (input.body.mode === 'local') {
    const baseUrl = typeof input.body.baseUrl === 'string' && input.body.baseUrl.trim()
      ? input.body.baseUrl.trim()
      : undefined
    const result = await createOllamaProviderSecret(baseUrl ? { baseUrl, mode: 'local' } : { mode: 'local' })

    if (!result.ok) {
      return { ok: false, response: getOllamaDiscoveryError(result.error) }
    }

    return { ok: true, secret: result.secret }
  }

  if (input.body.mode === 'remote') {
    const baseUrl = typeof input.body.baseUrl === 'string' ? input.body.baseUrl.trim() : ''
    const apiKey = typeof input.body.token === 'string'
      ? input.body.token.trim()
      : typeof input.body.apiKey === 'string'
        ? input.body.apiKey.trim()
        : ''

    if (!baseUrl || !apiKey) {
      return {
        ok: false,
        response: { error: 'missing_fields', message: 'baseUrl and token are required', status: 400 },
      }
    }

    const result = await createOllamaProviderSecret({ apiKey, baseUrl, mode: 'remote' })
    if (!result.ok) {
      return { ok: false, response: getOllamaDiscoveryError(result.error) }
    }

    return { ok: true, secret: result.secret }
  }

  return {
    ok: false,
    response: { error: 'missing_fields', message: 'mode is required', status: 400 },
  }
}
