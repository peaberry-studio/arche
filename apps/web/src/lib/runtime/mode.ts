export type RuntimeMode = 'web' | 'desktop'

const VALID_MODES = new Set<RuntimeMode>(['web', 'desktop'])

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const VALID_PLATFORMS = new Set(['darwin', 'win32', 'linux'])

export class DesktopEnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopEnvironmentError'
  }
}

export function validateDesktopEnvironment(): void {
  const platform = process.env.ARCHE_DESKTOP_PLATFORM
  if (!platform || !VALID_PLATFORMS.has(platform)) {
    throw new DesktopEnvironmentError(
      `Desktop mode requires ARCHE_DESKTOP_PLATFORM to be set to a valid platform (${[...VALID_PLATFORMS].join(', ')}). ` +
        'This variable is set automatically by the Electron shell. ' +
        'If you are not running inside the desktop app, use ARCHE_RUNTIME_MODE=web instead.'
    )
  }

  const host = process.env.ARCHE_DESKTOP_WEB_HOST
  if (!host || !LOOPBACK_HOSTS.has(host)) {
    throw new DesktopEnvironmentError(
      `Desktop mode requires ARCHE_DESKTOP_WEB_HOST to be a loopback address (${[...LOOPBACK_HOSTS].join(', ')}). ` +
        'The desktop runtime must only be accessible from the local machine.'
    )
  }
}

function resolveMode(): RuntimeMode {
  const raw = process.env.ARCHE_RUNTIME_MODE?.trim().toLowerCase()
  if (raw === 'desktop') {
    validateDesktopEnvironment()
    return 'desktop'
  }
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
