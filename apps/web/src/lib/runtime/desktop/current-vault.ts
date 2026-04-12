import { isDesktop } from '@/lib/runtime/mode'

export const DESKTOP_SETTINGS_SECTIONS = [
  'providers',
  'connectors',
  'agents',
  'skills',
  'appearance',
  'advanced',
] as const

export type DesktopSettingsSection = (typeof DESKTOP_SETTINGS_SECTIONS)[number]

export type CurrentDesktopVault = {
  vaultId: string
  vaultName: string
  vaultPath: string
}

function readDesktopEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export function isDesktopSettingsSection(value: string | null | undefined): value is DesktopSettingsSection {
  return DESKTOP_SETTINGS_SECTIONS.includes(value as DesktopSettingsSection)
}

export function getCurrentDesktopVault(): CurrentDesktopVault | null {
  if (!isDesktop()) {
    return null
  }

  const vaultId = readDesktopEnv('ARCHE_DESKTOP_VAULT_ID')
  const vaultName = readDesktopEnv('ARCHE_DESKTOP_VAULT_NAME')
  const vaultPath = readDesktopEnv('ARCHE_DESKTOP_VAULT_PATH')

  if (!vaultId || !vaultName || !vaultPath) {
    return null
  }

  return {
    vaultId,
    vaultName,
    vaultPath,
  }
}

export function getWorkspacePersistenceScope(slug: string): string {
  const vault = getCurrentDesktopVault()
  return vault ? `vault:${vault.vaultId}` : slug
}

export function getDesktopWorkspaceHref(
  slug: string,
  section?: DesktopSettingsSection | null,
): string {
  const basePath = `/w/${slug}`
  if (!section) {
    return basePath
  }

  return `${basePath}?settings=${section}`
}
