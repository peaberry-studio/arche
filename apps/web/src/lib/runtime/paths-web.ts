import type { RuntimePaths } from '@/lib/runtime/types'
import { assertValidSlug } from '@/lib/validation/slug'

export const webPaths: RuntimePaths = {
  kbConfigRoot: () => process.env.ARCHE_KB_CONFIG_PATH || process.env.KB_CONFIG_HOST_PATH || '/kb-config',
  kbContentRoot: () => process.env.ARCHE_KB_CONTENT_PATH || process.env.KB_CONTENT_HOST_PATH || '/kb-content',
  usersBasePath: () => process.env.ARCHE_USERS_PATH || '/opt/arche/users',
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    const base = process.env.ARCHE_USERS_PATH || '/opt/arche/users'
    return `${base}/${slug}`
  },
}
