import { getProviderGatewayPath } from '@/lib/providers/catalog'
import { isRecord } from '@/lib/records'

// OpenCode 2 reads its model catalog from `OPENCODE_MODELS_URL`. Zen and Go
// models carry their own `https://opencode.ai/inference/...` endpoints, which
// win over the provider-level gateway `baseURL`, so Arche serves the catalog
// with those endpoints pointed at the provider gateway.
const UPSTREAM_CATALOG_URL = 'https://models.opencode.ai/api.json'
const ZEN_INFERENCE_PREFIX = 'https://opencode.ai/inference/'
const ZEN_PROVIDER_IDS = ['opencode', 'opencode-go'] as const
const CATALOG_TTL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000
// After a failed fetch, starts reuse what they have instead of each waiting
// for the upstream timeout again.
const FAILURE_BACKOFF_MS = 15_000

type CatalogResult = { ok: true; data: string } | { ok: false; error: 'catalog_unavailable' }

let cache: { fetchedAt: number; catalog: Record<string, unknown>; rendered: Map<string, string> } | null = null
let pending: Promise<Record<string, unknown> | null> | null = null
let failedAt: number | null = null

function rewriteEndpoint(value: unknown, gatewayBase: string): unknown {
  return typeof value === 'string' && value.startsWith(ZEN_INFERENCE_PREFIX)
    ? `${gatewayBase}/inference/${value.slice(ZEN_INFERENCE_PREFIX.length)}`
    : value
}

function isZenCatalog(catalog: Record<string, unknown>): boolean {
  return ZEN_PROVIDER_IDS.every((id) => {
    const provider = catalog[id]
    if (!isRecord(provider) || provider.id !== id || typeof provider.api !== 'string' || !provider.api.startsWith(ZEN_INFERENCE_PREFIX) || !isRecord(provider.models)) return false
    const models = Object.values(provider.models)
    return models.length > 0 && models.every((model) => isRecord(model) && (
      model.provider === undefined || (isRecord(model.provider) && (
        model.provider.api === undefined || (typeof model.provider.api === 'string' && model.provider.api.startsWith(ZEN_INFERENCE_PREFIX))
      ))
    ))
  })
}

export function rewriteZenCatalog(catalog: Record<string, unknown>, gatewayRoot: string): Record<string, unknown> {
  const root = gatewayRoot.replace(/\/$/, '')
  const next = { ...catalog }
  for (const providerId of ZEN_PROVIDER_IDS) {
    const provider = catalog[providerId]
    if (!isRecord(provider)) continue
    const gatewayBase = `${root}/${getProviderGatewayPath(providerId)}`
    const models = isRecord(provider.models)
      ? Object.fromEntries(Object.entries(provider.models).map(([id, model]) => {
          if (!isRecord(model) || !isRecord(model.provider)) return [id, model]
          return [id, { ...model, provider: { ...model.provider, api: rewriteEndpoint(model.provider.api, gatewayBase) } }]
        }))
      : provider.models
    next[providerId] = { ...provider, api: rewriteEndpoint(provider.api, gatewayBase), models }
  }
  return next
}

async function fetchUpstreamCatalog(): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(UPSTREAM_CATALOG_URL, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    const catalog: unknown = await response.json()
    return isRecord(catalog) && isZenCatalog(catalog) ? catalog : null
  } catch {
    return null
  }
}

async function loadCatalog(): Promise<Record<string, unknown> | null> {
  if (cache && Date.now() - cache.fetchedAt < CATALOG_TTL_MS) return cache.catalog
  if (failedAt !== null && Date.now() - failedAt < FAILURE_BACKOFF_MS) return cache?.catalog ?? null
  pending ??= fetchUpstreamCatalog().finally(() => {
    pending = null
  })
  const catalog = await pending
  if (catalog) {
    failedAt = null
    if (cache?.catalog !== catalog) cache = { fetchedAt: Date.now(), catalog, rendered: new Map() }
    return catalog
  }
  failedAt ??= Date.now()
  // Serve the last good catalog while upstream is unavailable.
  return cache?.catalog ?? null
}

// A catalog Arche already rendered for this gateway: both Zen providers are
// present and every endpoint they carry points at the gateway, so no request
// can reach opencode.ai with a gateway token.
export function isGatewayModelsCatalog(content: string, gatewayRoot: string): boolean {
  let catalog: unknown
  try {
    catalog = JSON.parse(content)
  } catch {
    return false
  }
  if (!isRecord(catalog)) return false
  const root = gatewayRoot.replace(/\/$/, '')
  return ZEN_PROVIDER_IDS.every((id) => {
    const provider = catalog[id]
    const prefix = `${root}/${getProviderGatewayPath(id)}/inference/`
    if (!isRecord(provider) || provider.id !== id || typeof provider.api !== 'string' || !provider.api.startsWith(prefix) || !isRecord(provider.models)) return false
    const models = Object.values(provider.models)
    return models.length > 0 && models.every((model) => isRecord(model) && (
      model.provider === undefined || (isRecord(model.provider) && (
        model.provider.api === undefined || (typeof model.provider.api === 'string' && model.provider.api.startsWith(prefix))
      ))
    ))
  })
}

// `lastRendered` is the catalog a runtime host wrote on an earlier start. It is
// served when upstream is unavailable and this process has no copy of its own,
// so an outage or a cold process does not block starts.
export async function getGatewayModelsCatalog(gatewayRoot: string, lastRendered?: string | null): Promise<CatalogResult> {
  const catalog = await loadCatalog()
  if (!catalog || !cache) {
    return lastRendered && isGatewayModelsCatalog(lastRendered, gatewayRoot)
      ? { ok: true, data: lastRendered }
      : { ok: false, error: 'catalog_unavailable' }
  }
  let rendered = cache.rendered.get(gatewayRoot)
  if (rendered === undefined) {
    rendered = JSON.stringify(rewriteZenCatalog(catalog, gatewayRoot))
    cache.rendered.set(gatewayRoot, rendered)
  }
  return { ok: true, data: rendered }
}
