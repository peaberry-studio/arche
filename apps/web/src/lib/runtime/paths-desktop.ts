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

export const desktopPaths: RuntimePaths = {
  kbConfigRoot: () => joinRuntimePath(getDesktopAppDataRoot(), 'kb-config'),
  kbContentRoot: () => joinRuntimePath(getDesktopAppDataRoot(), 'kb-content'),
  usersBasePath: () => joinRuntimePath(getDesktopAppDataRoot(), 'users'),
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    return joinRuntimePath(getDesktopAppDataRoot(), 'users', slug)
  },
}
