import { getRuntimeMode, type RuntimeMode } from '@/lib/runtime/mode'

type MacOsInsetTitleBarContext = {
  runtimeMode: RuntimeMode
  desktopPlatform?: string | null
}

function normalizeDesktopPlatform(desktopPlatform?: string | null): string | null {
  const normalized = desktopPlatform?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function shouldUseMacOsInsetTitleBar({
  runtimeMode,
  desktopPlatform,
}: MacOsInsetTitleBarContext): boolean {
  return runtimeMode === 'desktop' && normalizeDesktopPlatform(desktopPlatform) === 'darwin'
}

export function shouldUseCurrentMacOsInsetTitleBar(): boolean {
  return shouldUseMacOsInsetTitleBar({
    runtimeMode: getRuntimeMode(),
    desktopPlatform: process.env.ARCHE_DESKTOP_PLATFORM,
  })
}
