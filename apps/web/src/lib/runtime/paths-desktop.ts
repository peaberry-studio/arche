import { join } from 'path'

import type { RuntimePaths } from '@/lib/runtime/types'
import { assertValidSlug } from '@/lib/validation/slug'

function getAppDataRoot(): string {
  return process.env.ARCHE_DATA_DIR || join(process.env.HOME || '', '.arche')
}

export const desktopPaths: RuntimePaths = {
  kbConfigRoot: () => join(getAppDataRoot(), 'kb-config'),
  kbContentRoot: () => join(getAppDataRoot(), 'kb-content'),
  usersBasePath: () => join(getAppDataRoot(), 'users'),
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    return join(getAppDataRoot(), 'users', slug)
  },
}
