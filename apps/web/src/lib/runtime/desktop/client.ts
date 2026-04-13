'use client'

export type DesktopVaultSummary = {
  id: string
  name: string
  path: string
  lastOpenedAt?: string
}

export type DesktopApiResult =
  | { ok: true }
  | { ok: false; error: string }

type ArcheDesktopBridge = {
  createVault: (args: { kickstartPayload: unknown; parentPath: string; name: string }) => Promise<DesktopApiResult>
  getCurrentVault: () => Promise<DesktopVaultSummary | null>
  listRecentVaults: () => Promise<DesktopVaultSummary[]>
  openExistingVault: () => Promise<DesktopApiResult>
  openVault: (vaultPath: string) => Promise<DesktopApiResult>
  openVaultLauncher: () => Promise<DesktopApiResult>
  pickVaultParentDirectory: () => Promise<string | null>
  quitLauncherProcess: () => Promise<DesktopApiResult>
  revealAttachmentsDirectory: () => Promise<DesktopApiResult>
}

type ArcheBridge = {
  platform?: string
  isDesktop?: boolean
  desktop?: ArcheDesktopBridge
}

function getArcheBridge(): ArcheBridge | null {
  if (typeof window === 'undefined') {
    return null
  }

  const bridge = (window as Window & { arche?: ArcheBridge }).arche
  return bridge ?? null
}

export function isDesktopBridgeAvailable(): boolean {
  const bridge = getArcheBridge()
  return Boolean(bridge?.isDesktop && bridge.desktop)
}

export function getOptionalDesktopBridge(): ArcheDesktopBridge | null {
  const bridge = getArcheBridge()
  if (!bridge?.isDesktop || !bridge.desktop) {
    return null
  }

  return bridge.desktop
}

export function getDesktopBridge(): ArcheDesktopBridge {
  const bridge = getOptionalDesktopBridge()
  if (!bridge) {
    throw new Error('Desktop bridge is unavailable')
  }

  return bridge
}

export function getDesktopPlatform(): string | null {
  return getArcheBridge()?.platform ?? null
}
