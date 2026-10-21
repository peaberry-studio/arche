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

type CatalogResult = { ok: true; data: string } | { ok: false; error: 'catalog_unavailable' }

let cache: { fetchedAt: number; catalog: Record<string, unknown>; rendered: Map<string, string> } | null = null
let pending: Promise<Record<string, unknown> | null> | null = null

function rewriteEndpoint(value: unknown, gatewayBase: string): unknown {
  return typeof value === 'string' && value.startsWith(ZEN_INFERENCE_PREFIX)
    ? `${gatewayBase}/inference/${value.slice(ZEN_INFERENCE_PREFIX.length)}`
    : value
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
    const response = await fetch(UPSTREAM_CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    const catalog: unknown = await response.json()
    return isRecord(catalog) ? catalog : null
  } catch {
    return null
  }
}

async function loadCatalog(): Promise<Record<string, unknown> | null> {
  if (cache && Date.now() - cache.fetchedAt < CATALOG_TTL_MS) return cache.catalog
  pending ??= fetchUpstreamCatalog().finally(() => {
    pending = null
  })
  const catalog = await pending
  if (catalog) {
    if (cache?.catalog !== catalog) cache = { fetchedAt: Date.now(), catalog, rendered: new Map() }
    return catalog
  }
  // Serve the last good catalog while upstream is unavailable.
  return cache?.catalog ?? null
}

export async function getGatewayModelsCatalog(gatewayRoot: string): Promise<CatalogResult> {
  const catalog = await loadCatalog()
  if (!catalog || !cache) return { ok: false, error: 'catalog_unavailable' }
  let rendered = cache.rendered.get(gatewayRoot)
  if (rendered === undefined) {
    rendered = JSON.stringify(rewriteZenCatalog(catalog, gatewayRoot))
    cache.rendered.set(gatewayRoot, rendered)
  }
  return { ok: true, data: rendered }
}
