import { mkdir } from 'fs/promises'

import { getUserDataPath } from '@/lib/runtime/paths'
import { assertValidSlug } from '@/lib/validation/slug'

export async function ensureUserDirectory(slug: string): Promise<string> {
  assertValidSlug(slug)
  const userPath = getUserDataPath(slug)
  await mkdir(userPath, { recursive: true, mode: 0o700 })
  return userPath
}

export function getUserDataHostPath(slug: string): string {
  assertValidSlug(slug)
  return getUserDataPath(slug)
}
