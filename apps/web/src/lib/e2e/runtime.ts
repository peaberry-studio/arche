const E2E_HOOKS_ENABLED_ENV = 'ARCHE_ENABLE_E2E_HOOKS'
const E2E_RUNTIME_BASE_URL_ENV = 'ARCHE_E2E_RUNTIME_BASE_URL'
const E2E_RUNTIME_PASSWORD_ENV = 'ARCHE_E2E_RUNTIME_PASSWORD'
const E2E_FAKE_PROVIDER_URL_ENV = 'ARCHE_E2E_FAKE_PROVIDER_URL'
const DEFAULT_USERNAME = 'opencode'
const loggedE2eOverrides = new Set<string>()

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.replace(/\/+$/, '')
}

function logE2eOverrideActivation(kind: string, envName: string, target: string): void {
  const key = `${kind}:${target}`
  if (loggedE2eOverrides.has(key)) {
    return
  }

  loggedE2eOverrides.add(key)
  console.warn(`[e2e] ${kind} override enabled via ${envName} in a non-production process: ${target}`)
}

export function isE2eHooksEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env[E2E_HOOKS_ENABLED_ENV]?.trim() === '1'
}

export function getE2eRuntimeBaseUrl(): string | null {
  if (!isE2eHooksEnabled()) {
    return null
  }

  const baseUrl = normalizeBaseUrl(process.env[E2E_RUNTIME_BASE_URL_ENV])
  if (!baseUrl) {
    return null
  }

  logE2eOverrideActivation('fake runtime', E2E_RUNTIME_BASE_URL_ENV, baseUrl)
  return baseUrl
}

export function getE2eRuntimePassword(): string | null {
  if (!isE2eHooksEnabled()) {
    return null
  }

  const password = process.env[E2E_RUNTIME_PASSWORD_ENV]?.trim()
  return password ? password : null
}

export function getE2eFakeProviderUrl(): string | null {
  if (!isE2eHooksEnabled()) {
    return null
  }

  const baseUrl = normalizeBaseUrl(process.env[E2E_FAKE_PROVIDER_URL_ENV])
  if (!baseUrl) {
    return null
  }

  logE2eOverrideActivation('fake provider', E2E_FAKE_PROVIDER_URL_ENV, baseUrl)
  return baseUrl
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
