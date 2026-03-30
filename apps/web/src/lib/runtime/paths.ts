import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { desktopPaths } from '@/lib/runtime/paths-desktop'
import { webPaths } from '@/lib/runtime/paths-web'
import type { RuntimePaths } from '@/lib/runtime/types'

function getPaths(): RuntimePaths {
  const caps = getRuntimeCapabilities()
  return caps.containers ? webPaths : desktopPaths
}

export function getKbConfigRoot(): string {
  return getPaths().kbConfigRoot()
}

export function getKbContentRoot(): string {
  return getPaths().kbContentRoot()
}

export function getUsersBasePath(): string {
  return getPaths().usersBasePath()
}

export function getUserDataPath(slug: string): string {
  return getPaths().userDataPath(slug)
}
