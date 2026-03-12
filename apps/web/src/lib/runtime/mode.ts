export type RuntimeMode = 'web' | 'desktop'

const VALID_MODES = new Set<RuntimeMode>(['web', 'desktop'])

function resolveMode(): RuntimeMode {
  const raw = process.env.ARCHE_RUNTIME_MODE?.trim().toLowerCase()
  if (raw && VALID_MODES.has(raw as RuntimeMode)) {
    return raw as RuntimeMode
  }
  return 'web'
}

let cached: RuntimeMode | null = null

export function getRuntimeMode(): RuntimeMode {
  if (cached) return cached
  cached = resolveMode()
  return cached
}

export function isWeb(): boolean {
  return getRuntimeMode() === 'web'
}

export function isDesktop(): boolean {
  return getRuntimeMode() === 'desktop'
}
