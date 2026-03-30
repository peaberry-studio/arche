import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { webPaths } from '@/lib/runtime/paths-web'
import type { RuntimePaths } from '@/lib/runtime/types'
import { assertValidSlug } from '@/lib/validation/slug'

function joinRuntimePath(...segments: string[]): string {
  const normalized = segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (index === 0) return segment.replace(/[\\/]+$/g, '')
      return segment.replace(/^[/\\]+|[/\\]+$/g, '')
    })

  if (normalized.length === 0) return '.'
  return normalized.join('/')
}

function getDesktopAppDataRoot(): string {
  return process.env.ARCHE_DATA_DIR || joinRuntimePath(process.env.HOME || '', '.arche')
}

const desktopPaths: RuntimePaths = {
  kbConfigRoot: () => joinRuntimePath(getDesktopAppDataRoot(), 'kb-config'),
  kbContentRoot: () => joinRuntimePath(getDesktopAppDataRoot(), 'kb-content'),
  usersBasePath: () => joinRuntimePath(getDesktopAppDataRoot(), 'users'),
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    return joinRuntimePath(getDesktopAppDataRoot(), 'users', slug)
  },
}

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
