import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DesktopSettingsDialog } from '@/components/desktop/desktop-settings-dialog'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'
import { ensureAutopilotSchedulerStarted } from '@/lib/autopilot/scheduler-bootstrap'
import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import type { KnowledgeGraphAgentSource } from '@/lib/kb-graph'
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
import { getAgentSummaries, parseCommonWorkspaceConfig } from '@/lib/workspace-config'
import { getKickstartStatus } from '@/kickstart/status'

async function loadKnowledgeAgentSources(): Promise<KnowledgeGraphAgentSource[]> {
  const configResult = await readCommonWorkspaceConfig()
  if (!configResult.ok) return []

  const parsedConfig = parseCommonWorkspaceConfig(configResult.content)
  if (!parsedConfig.ok) return []

  return getAgentSummaries(parsedConfig.config).map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    prompt: agent.prompt,
  }))
}

export default async function WorkspaceHostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ mode?: string; path?: string; session?: string; settings?: string }>
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
  const requestedWorkspaceMode = search?.mode === 'knowledge'
    ? 'knowledge'
    : search?.mode === 'tasks'
      ? 'tasks'
      : 'chat'
  const initialWorkspaceMode = desktopVault && requestedWorkspaceMode === 'tasks'
    ? 'chat'
    : requestedWorkspaceMode
  const knowledgeAgentSources = await loadKnowledgeAgentSources()

  return (
    <>
      <WorkspaceShell
        slug={slug}
        persistenceScope={persistenceScope}
        currentVault={desktopVault ? { id: desktopVault.vaultId, name: desktopVault.vaultName, path: desktopVault.vaultPath } : null}
        initialFilePath={search?.path ?? null}
        initialSessionId={search?.session ?? null}
        initialWorkspaceMode={initialWorkspaceMode}
        knowledgeAgentSources={knowledgeAgentSources}
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
