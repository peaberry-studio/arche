const E2E_RUNTIME_BASE_URL_ENV = 'ARCHE_E2E_RUNTIME_BASE_URL'
const E2E_RUNTIME_PASSWORD_ENV = 'ARCHE_E2E_RUNTIME_PASSWORD'
const DEFAULT_USERNAME = 'opencode'

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.replace(/\/+$/, '')
}

export function getE2eRuntimeBaseUrl(): string | null {
  return normalizeBaseUrl(process.env[E2E_RUNTIME_BASE_URL_ENV])
}

export function getE2eRuntimePassword(): string | null {
  const password = process.env[E2E_RUNTIME_PASSWORD_ENV]?.trim()
  return password ? password : null
}

export function isE2eFakeRuntimeEnabled(): boolean {
  return getE2eRuntimeBaseUrl() !== null && getE2eRuntimePassword() !== null
}

export function getE2eRuntimeConnection(overrideBaseUrl?: string): {
  authHeader: string
  baseUrl: string
  password: string
} | null {
  const password = getE2eRuntimePassword()
  const baseUrl = normalizeBaseUrl(overrideBaseUrl) ?? getE2eRuntimeBaseUrl()

  if (!baseUrl || !password) {
    return null
  }

  return {
    baseUrl,
    password,
    authHeader: `Basic ${Buffer.from(`${DEFAULT_USERNAME}:${password}`).toString('base64')}`,
  }
}
