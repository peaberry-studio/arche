import type { RuntimePaths } from '@/lib/runtime/types'
import { assertValidSlug } from '@/lib/validation/slug'

function getDesktopSeparator(): '/' | '\\' {
  return process.env.ARCHE_DESKTOP_PLATFORM === 'win32' ? '\\' : '/'
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSeparators(value: string, separator: string): string {
  return value.replace(/[\\/]+/g, separator)
}

function trimLeadingSeparators(value: string, separator: string): string {
  return value.replace(new RegExp(`^${escapeForRegex(separator)}+`), '')
}

function trimTrailingSeparators(value: string, separator: string): string {
  return value.replace(new RegExp(`${escapeForRegex(separator)}+$`), '')
}

function joinDesktopPath(...parts: string[]): string {
  const separator = getDesktopSeparator()
  const filteredParts = parts.filter((part) => part.length > 0)

  if (filteredParts.length === 0) {
    return ''
  }

  const firstPart = normalizeSeparators(filteredParts[0], separator)
  let result = firstPart === separator ? separator : trimTrailingSeparators(firstPart, separator)

  for (const part of filteredParts.slice(1)) {
    const normalizedPart = trimTrailingSeparators(
      trimLeadingSeparators(normalizeSeparators(part, separator), separator),
      separator,
    )

    if (!normalizedPart) {
      continue
    }

    if (!result || result.endsWith(separator)) {
      result += normalizedPart
      continue
    }

    result += `${separator}${normalizedPart}`
  }

  return result
}

function getAppDataRoot(): string {
  return process.env.ARCHE_DATA_DIR || joinDesktopPath(process.env.HOME || '', '.arche')
}

export const desktopPaths: RuntimePaths = {
  kbConfigRoot: () => joinDesktopPath(getAppDataRoot(), 'kb-config'),
  kbContentRoot: () => joinDesktopPath(getAppDataRoot(), 'kb-content'),
  usersBasePath: () => joinDesktopPath(getAppDataRoot(), 'users'),
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    return joinDesktopPath(getAppDataRoot(), 'users', slug)
  },
}
