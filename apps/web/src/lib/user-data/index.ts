import { getUserDataPath } from '@/lib/runtime/paths'
import { assertValidSlug } from '@/lib/validation/slug'

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

export async function ensureUserDirectory(slug: string): Promise<string> {
  assertValidSlug(slug)
  const userPath = getUserDataPath(slug)
  const { mkdir } = await importRuntimeModule<typeof import('fs/promises')>('fs/promises')
  await mkdir(userPath, { recursive: true, mode: 0o700 })
  return userPath
}

export function getUserDataHostPath(slug: string): string {
  assertValidSlug(slug)
  return getUserDataPath(slug)
}
