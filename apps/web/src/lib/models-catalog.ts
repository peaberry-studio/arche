export type ModelCatalogEntry = {
  id: string
  label: string
}

type ModelsDevProvider = {
  name?: string
  models?: Record<string, { name?: string }>
}

type ModelsCatalogCache = {
  fetchedAtMs: number
  data: ModelCatalogEntry[]
}

const MODELS_DEV_URL = 'https://models.dev/api.json'
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000
const PROVIDER_ID_ALIASES: Record<string, string> = {
  'fireworks-ai': 'fireworks',
}

let modelsCatalogCache: ModelsCatalogCache | null = null

function toProviderLabel(providerId: string, providerName?: string): string {
  if (providerName && providerName.trim()) return providerName.trim()
  return providerId
}

function normalizeProviderId(providerId: string): string {
  return PROVIDER_ID_ALIASES[providerId] ?? providerId
}

export async function fetchModelsCatalog(): Promise<
  | { ok: true; models: ModelCatalogEntry[] }
  | { ok: false; error: string }
> {
  const now = Date.now()
  if (modelsCatalogCache && now - modelsCatalogCache.fetchedAtMs < MODELS_CACHE_TTL_MS) {
    return { ok: true, models: modelsCatalogCache.data }
  }

  let payload: Record<string, ModelsDevProvider>
  try {
    const response = await fetch(MODELS_DEV_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      return { ok: false, error: 'models_catalog_unavailable' }
    }

    payload = (await response.json()) as Record<string, ModelsDevProvider>
  } catch {
    return { ok: false, error: 'models_catalog_unavailable' }
  }

  const entries: ModelCatalogEntry[] = []
  for (const [providerId, provider] of Object.entries(payload)) {
    const normalizedProviderId = normalizeProviderId(providerId)
    const providerLabel = toProviderLabel(normalizedProviderId, provider.name)
    const models = provider.models ?? {}
    for (const [modelId, model] of Object.entries(models)) {
      const id = `${normalizedProviderId}/${modelId}`
      const modelName = model.name?.trim() || modelId
      entries.push({
        id,
        label: `${providerLabel} - ${modelName}`,
      })
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id))
  modelsCatalogCache = { fetchedAtMs: now, data: entries }

  return { ok: true, models: entries }
}
