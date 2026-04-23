import { isE2eHooksEnabled } from '@/lib/e2e/runtime'
import type { RuntimePaths } from '@/lib/runtime/types'
import { assertValidSlug } from '@/lib/validation/slug'

function getE2eWebPathOverride(value: string | undefined, fallback: string): string {
  return isE2eHooksEnabled() && value ? value : fallback
}

export const webPaths: RuntimePaths = {
  kbConfigRoot: () => getE2eWebPathOverride(process.env.KB_CONFIG_HOST_PATH, '/kb-config'),
  kbContentRoot: () => getE2eWebPathOverride(process.env.KB_CONTENT_HOST_PATH, '/kb-content'),
  usersBasePath: () => process.env.ARCHE_USERS_PATH || '/opt/arche/users',
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    const base = process.env.ARCHE_USERS_PATH || '/opt/arche/users'
    return `${base}/${slug}`
  },
}
