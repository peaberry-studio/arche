import { isRecord } from '@/lib/records'
import { validateConnectorTestEndpoint, type LookupHost } from '@/lib/security/ssrf'

import type { OllamaDiscoveredModel, OllamaMode, OllamaSecret } from './types'

export const OLLAMA_LOCAL_BASE_URL_CANDIDATES = [
  'http://127.0.0.1:11434/v1',
  'http://localhost:11434/v1',
  'http://host.containers.internal:11434/v1',
] as const

const OLLAMA_DISCOVERY_TIMEOUT_MS = 5_000

export type OllamaDiscoveryError = 'invalid_url' | 'blocked_url' | 'missing_token' | 'unavailable'

export type OllamaDiscoveryResult =
  | { ok: true; baseUrl: string; models: OllamaDiscoveredModel[] }
  | { ok: false; error: OllamaDiscoveryError }

export type OllamaSecretResult =
  | { ok: true; secret: OllamaSecret }
  | { ok: false; error: OllamaDiscoveryError }

type OllamaDiscoveryOptions = {
  fetchImpl?: typeof fetch
  lookupHost?: LookupHost
  timeoutMs?: number
}

type CreateOllamaProviderSecretInput =
  | { baseUrl?: string; mode: 'local' }
  | { apiKey: string; baseUrl: string; mode: 'remote' }

export type OllamaPublicDetails = {
  baseUrl: string
  discoveredAt: string
  mode: OllamaMode
  models: OllamaDiscoveredModel[]
}

function normalizeBaseUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  }
}

function parseModelsPayload(payload: unknown): OllamaDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return []
  }

  const models: OllamaDiscoveredModel[] = []
  for (const entry of payload.data) {
    if (!isRecord(entry)) continue

    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) continue

    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id
    models.push({ id, name })
  }

  return models
}

async function fetchOllamaModels(
  baseUrl: string,
  apiKey: string | null,
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? OLLAMA_DISCOVERY_TIMEOUT_MS
  const { signal, cleanup } = createAbortSignal(timeoutMs)
  const headers = new Headers({ accept: 'application/json' })

  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`)
  }

  try {
    const response = await fetchImpl(buildModelsUrl(baseUrl), {
      cache: 'no-store',
      headers,
      method: 'GET',
      signal,
    })

    if (!response.ok) {
      return { ok: false, error: 'unavailable' }
    }

    const payload: unknown = await response.json()
    return { ok: true, baseUrl, models: parseModelsPayload(payload) }
  } catch {
    return { ok: false, error: 'unavailable' }
  } finally {
    cleanup()
  }
}

export async function validateOllamaURL(
  rawUrl: string,
  options: { lookupHost?: LookupHost } = {},
): Promise<{ ok: true; baseUrl: string } | { ok: false; error: 'invalid_url' | 'blocked_url' }> {
  const baseUrl = normalizeBaseUrl(rawUrl)
  if (!baseUrl) {
    return { ok: false, error: 'invalid_url' }
  }

  const result = await validateConnectorTestEndpoint(baseUrl, { lookupHost: options.lookupHost })
  if (!result.ok) {
    return { ok: false, error: result.error === 'blocked_endpoint' ? 'blocked_url' : 'invalid_url' }
  }

  return { ok: true, baseUrl: result.url.toString().replace(/\/+$/, '') }
}

export async function discoverOllamaLocal(
  rawBaseUrl: string,
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaDiscoveryResult> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl)
  if (!baseUrl) {
    return { ok: false, error: 'invalid_url' }
  }

  return fetchOllamaModels(baseUrl, null, options)
}

export async function discoverOllamaLocalCandidates(
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaDiscoveryResult> {
  let lastResult: OllamaDiscoveryResult = { ok: false, error: 'unavailable' }

  for (const baseUrl of OLLAMA_LOCAL_BASE_URL_CANDIDATES) {
    const result = await discoverOllamaLocal(baseUrl, options)
    if (result.ok) {
      return result
    }
    lastResult = result
  }

  return lastResult
}

export async function discoverOllamaRemote(
  rawBaseUrl: string,
  rawApiKey: string,
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaDiscoveryResult> {
  const apiKey = rawApiKey.trim()
  if (!apiKey) {
    return { ok: false, error: 'missing_token' }
  }

  const validation = await validateOllamaURL(rawBaseUrl, { lookupHost: options.lookupHost })
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }

  return fetchOllamaModels(validation.baseUrl, apiKey, options)
}

export async function createOllamaProviderSecret(
  input: CreateOllamaProviderSecretInput,
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaSecretResult> {
  const discovery = input.mode === 'local'
    ? input.baseUrl
      ? await discoverOllamaLocal(input.baseUrl, options)
      : await discoverOllamaLocalCandidates(options)
    : await discoverOllamaRemote(input.baseUrl, input.apiKey, options)

  if (!discovery.ok) {
    return discovery
  }

  return {
    ok: true,
    secret: {
      ...(input.mode === 'remote' ? { apiKey: input.apiKey.trim() } : {}),
      baseUrl: discovery.baseUrl,
      discoveredAt: new Date().toISOString(),
      mode: input.mode,
      models: discovery.models,
    },
  }
}

export async function refreshOllamaProviderSecret(
  secret: OllamaSecret,
  options: OllamaDiscoveryOptions = {},
): Promise<OllamaSecretResult> {
  const discovery = secret.mode === 'local'
    ? await discoverOllamaLocal(secret.baseUrl, options)
    : await discoverOllamaRemote(secret.baseUrl, secret.apiKey ?? '', options)

  if (!discovery.ok) {
    return discovery
  }

  return {
    ok: true,
    secret: {
      ...(secret.mode === 'remote' ? { apiKey: secret.apiKey } : {}),
      baseUrl: discovery.baseUrl,
      discoveredAt: new Date().toISOString(),
      mode: secret.mode,
      models: discovery.models,
    },
  }
}

export function isOllamaSecret(secret: unknown): secret is OllamaSecret {
  if (!isRecord(secret)) return false

  const mode = secret.mode
  const baseUrl = secret.baseUrl
  const discoveredAt = secret.discoveredAt
  const models = secret.models
  const apiKey = secret.apiKey

  return (
    (mode === 'local' || mode === 'remote') &&
    typeof baseUrl === 'string' &&
    baseUrl.trim().length > 0 &&
    typeof discoveredAt === 'string' &&
    Array.isArray(models) &&
    models.every((model) => (
      isRecord(model) &&
      typeof model.id === 'string' &&
      model.id.trim().length > 0 &&
      typeof model.name === 'string'
    )) &&
    (apiKey === undefined || typeof apiKey === 'string')
  )
}

export function getOllamaBaseUrlFromSecret(secret: unknown): string | null {
  return isOllamaSecret(secret) ? secret.baseUrl : null
}

export function getOllamaPublicDetails(secret: unknown): OllamaPublicDetails | null {
  if (!isOllamaSecret(secret)) {
    return null
  }

  return {
    baseUrl: secret.baseUrl,
    discoveredAt: secret.discoveredAt,
    mode: secret.mode,
    models: secret.models,
  }
}
