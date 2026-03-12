import type { RuntimePaths } from '@/lib/runtime/types'

export const webPaths: RuntimePaths = {
  kbConfigRoot: () => '/kb-config',
  kbContentRoot: () => '/kb-content',
  usersBasePath: () => process.env.ARCHE_USERS_PATH || '/opt/arche/users',
  userDataPath: (slug: string) => {
    const base = process.env.ARCHE_USERS_PATH || '/opt/arche/users'
    return `${base}/${slug}`
  },
}
