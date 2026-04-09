import type { DesktopLaunchContext } from './vault-launch'

type DesktopNextDistContext = {
  currentVaultId: string | null
  isPackaged: boolean
  launchContext: DesktopLaunchContext
}

const DEFAULT_PACKAGED_NEXT_DIST_DIR = '.next-desktop'

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-')
}

export function getDesktopNextDistDirName({
  currentVaultId,
  isPackaged,
  launchContext,
}: DesktopNextDistContext): string {
  if (isPackaged) {
    return DEFAULT_PACKAGED_NEXT_DIST_DIR
  }

  if (launchContext.mode === 'launcher') {
    return '.next-desktop-launcher'
  }

  const vaultId = sanitizeSegment(currentVaultId ?? 'unknown')
  return `.next-desktop-vault-${vaultId}`
}
