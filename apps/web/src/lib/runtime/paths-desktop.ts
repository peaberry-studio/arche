import type { RuntimePaths } from '@/lib/runtime/types'
import {
  DESKTOP_KB_CONFIG_DIR_NAME,
  DESKTOP_KB_CONTENT_DIR_NAME,
  DESKTOP_USERS_DIR_NAME,
} from '@/lib/runtime/desktop/vault-layout-constants'

import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { assertValidSlug } from '@/lib/validation/slug'

function getDesktopSeparator(): '/' | '\\' {
  return process.env.ARCHE_DESKTOP_PLATFORM === 'win32' ? '\\' : '/'
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSeparators(value: string, separator: string): string {
  return value.replace(/[\\/]/g, separator)
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

function getRequiredVaultRoot(): string {
  const contextVaultRoot = getDesktopVaultRuntimeContext()?.vaultRoot?.trim()
  if (contextVaultRoot) {
    return contextVaultRoot
  }

  const vaultRoot = process.env.ARCHE_DATA_DIR?.trim()
  if (!vaultRoot) {
    throw new Error('Desktop mode requires ARCHE_DATA_DIR to point at the selected vault root')
  }

  return vaultRoot
}

export const desktopPaths: RuntimePaths = {
  kbConfigRoot: () => joinDesktopPath(getRequiredVaultRoot(), DESKTOP_KB_CONFIG_DIR_NAME),
  kbContentRoot: () => joinDesktopPath(getRequiredVaultRoot(), DESKTOP_KB_CONTENT_DIR_NAME),
  usersBasePath: () => joinDesktopPath(getRequiredVaultRoot(), DESKTOP_USERS_DIR_NAME),
  userDataPath: (slug: string) => {
    assertValidSlug(slug)
    return joinDesktopPath(getRequiredVaultRoot(), DESKTOP_USERS_DIR_NAME, slug)
  },
}
