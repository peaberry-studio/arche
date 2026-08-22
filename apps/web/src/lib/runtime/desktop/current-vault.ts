import { isDesktop } from '@/lib/runtime/mode'
import { getWorkspaceFlowsHref } from '@/lib/workspace-hrefs'

export const DESKTOP_FLOWS_VIEWS = [
  'list',
  'new',
  'edit',
  'runs',
] as const

export type DesktopFlowsView = (typeof DESKTOP_FLOWS_VIEWS)[number]

export type CurrentDesktopVault = {
  vaultId: string
  vaultName: string
  vaultPath: string
}

function readDesktopEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export function isDesktopFlowsView(value: string | null | undefined): value is DesktopFlowsView {
  return DESKTOP_FLOWS_VIEWS.includes(value as DesktopFlowsView)
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

export function getDesktopFlowsHref(
  slug: string,
  view: DesktopFlowsView,
  flowId?: string | null,
  sessionId?: string | null,
): string {
  return getWorkspaceFlowsHref(slug, view, flowId ?? null, sessionId)
}
