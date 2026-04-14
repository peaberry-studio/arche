import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DesktopSettingsDialog } from '@/components/desktop/desktop-settings-dialog'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'
import { ensureAutopilotSchedulerStarted } from '@/lib/autopilot/scheduler-bootstrap'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import {
  getCurrentDesktopVault,
  getWorkspacePersistenceScope,
  isDesktopSettingsSection,
} from '@/lib/runtime/desktop/current-vault'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import {
  getWorkspaceLayoutCookieName,
  getWorkspaceLeftPanelCookieName,
  normalizeLeftPanelState,
  parseStoredLeftPanelState,
  parseWorkspaceLayoutState,
} from '@/lib/workspace-panel-state'
import { getKickstartStatus } from '@/kickstart/status'

export default async function WorkspaceHostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ path?: string; session?: string; settings?: string }>
}) {
  const { slug } = await params
  const search = await searchParams
  const desktopVault = getCurrentDesktopVault()

  if (isDesktop() && !desktopVault) {
    redirect('/')
  }

  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/w/${session.user.slug}`)
  }

  const kickstartStatus = await getKickstartStatus()
  if (kickstartStatus !== 'ready') {
    if (desktopVault) {
      redirect(`/u/${slug}/kickstart`)
    }

    const setupParam = kickstartStatus === 'setup_in_progress' ? 'in-progress' : 'required'
    redirect(`/u/${slug}?setup=${setupParam}`)
  }

  const caps = getRuntimeCapabilities()
  await ensureAutopilotSchedulerStarted()
  const cookieStore = await cookies()
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()
  const persistenceScope = getWorkspacePersistenceScope(slug)
  const initialLayoutCookie = cookieStore.get(getWorkspaceLayoutCookieName(persistenceScope))?.value
  const initialLeftPanelCookie = cookieStore.get(getWorkspaceLeftPanelCookieName(persistenceScope))?.value
  const initialLayoutState = initialLayoutCookie ? parseWorkspaceLayoutState(initialLayoutCookie) : null
  const initialLeftPanelState = initialLeftPanelCookie
    ? normalizeLeftPanelState(parseStoredLeftPanelState(initialLeftPanelCookie))
    : null
  const initialSettingsSection = desktopVault && isDesktopSettingsSection(search?.settings)
    ? search.settings
    : null

  return (
    <>
      <WorkspaceShell
        slug={slug}
        persistenceScope={persistenceScope}
        currentVault={desktopVault ? { id: desktopVault.vaultId, name: desktopVault.vaultName, path: desktopVault.vaultPath } : null}
        initialFilePath={search?.path ?? null}
        initialSessionId={search?.session ?? null}
        initialLayoutState={initialLayoutState}
        initialLeftPanelState={initialLeftPanelState}
        macDesktopWindowInset={macDesktopWindowInset}
        workspaceAgentEnabled={caps.workspaceAgent}
        reaperEnabled={caps.reaper}
      />
      {desktopVault ? <DesktopSettingsDialog slug={slug} currentSection={initialSettingsSection} /> : null}
    </>
  )
}
