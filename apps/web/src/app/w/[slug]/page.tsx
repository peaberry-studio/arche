import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DesktopFlowsDialog } from '@/components/desktop/desktop-flows-dialog'
import { DesktopSettingsDialog } from '@/components/desktop/desktop-settings-dialog'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'
import { ensureFlowSchedulerStarted } from '@/lib/flows/scheduler-bootstrap'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import {
  getCurrentDesktopVault,
  getWorkspacePersistenceScope,
  isDesktopFlowsView,
  isDesktopSettingsSection,
} from '@/lib/runtime/desktop/current-vault'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import {
  getWorkspaceLayoutCookieName,
  parseWorkspaceLayoutState,
} from '@/lib/workspace-panel-state'
import { getKickstartStatus } from '@/kickstart/status'

export default async function WorkspaceHostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ flowId?: string; flows?: string; mode?: string; path?: string; session?: string; settings?: string }>
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

  if (!desktopVault && search?.mode === 'flows') {
    if (search.session) {
      const params = new URLSearchParams({ session: search.session })
      if (search.path) params.set('path', search.path)
      if (search.settings) params.set('settings', search.settings)
      if (search.flowId) params.set('flowId', search.flowId)
      if (search.flows) params.set('flows', search.flows)
      redirect(`/w/${slug}?${params.toString()}`)
    }
    redirect(`/u/${slug}/flows`)
  }

  if (search?.mode === 'explore' || (search?.path && search?.mode !== 'flows')) {
    const params = new URLSearchParams()
    if (search.path) params.set('path', search.path)
    const query = params.toString()
    redirect(query ? `/w/${slug}/explore?${query}` : `/w/${slug}/explore`)
  }

  if (search?.mode === 'knowledge') {
    const params = new URLSearchParams()
    if (search.session) params.set('session', search.session)
    if (search.settings) params.set('settings', search.settings)
    const query = params.toString()
    redirect(query ? `/w/${slug}?${query}` : `/w/${slug}`)
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
  await ensureFlowSchedulerStarted()
  const cookieStore = await cookies()
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()
  const persistenceScope = getWorkspacePersistenceScope(slug)
  const initialLayoutCookie = cookieStore.get(getWorkspaceLayoutCookieName(persistenceScope))?.value
  const initialLayoutState = initialLayoutCookie ? parseWorkspaceLayoutState(initialLayoutCookie) : null
  const initialFlowsView = desktopVault && isDesktopFlowsView(search?.flows)
    ? search.flows
    : null
  const initialFlowId = desktopVault && search?.flowId
    ? search.flowId
    : null
  const initialSettingsSection = desktopVault && !initialFlowsView && isDesktopSettingsSection(search?.settings)
    ? search.settings
    : null

  return (
    <>
      <WorkspaceShell
        slug={slug}
        persistenceScope={persistenceScope}
        currentVault={desktopVault ? { id: desktopVault.vaultId, name: desktopVault.vaultName, path: desktopVault.vaultPath } : null}
        initialSessionId={search?.session ?? null}
        initialLayoutState={initialLayoutState}
        macDesktopWindowInset={macDesktopWindowInset}
        workspaceAgentEnabled={caps.workspaceAgent}
        reaperEnabled={caps.reaper}
      />
      {desktopVault ? (
        <>
          <DesktopSettingsDialog slug={slug} currentSection={initialSettingsSection} />
          <DesktopFlowsDialog
            slug={slug}
            currentView={initialFlowsView}
            flowId={initialFlowId}
            macDesktopWindowInset={macDesktopWindowInset}
            slackIntegrationAvailable={caps.slackIntegration}
            teamVisibilityAvailable={caps.teamManagement}
          />
        </>
      ) : null}
    </>
  )
}
