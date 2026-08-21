import { redirect } from 'next/navigation'

import { ExploreShell } from '@/components/workspace/explore-shell'
import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { ensureFlowSchedulerStarted } from '@/lib/flows/scheduler-bootstrap'
import type { KnowledgeGraphAgentSource } from '@/lib/kb-graph'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getWorkspacePersistenceScope } from '@/lib/runtime/desktop/current-vault'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
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

export default async function WorkspaceExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ path?: string }>
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
  await ensureFlowSchedulerStarted()
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()
  const persistenceScope = getWorkspacePersistenceScope(slug)
  const knowledgeAgentSources = await loadKnowledgeAgentSources()

  return (
    <ExploreShell
      slug={slug}
      persistenceScope={persistenceScope}
      initialFilePath={search?.path ?? null}
      knowledgeAgentSources={knowledgeAgentSources}
      macDesktopWindowInset={macDesktopWindowInset}
      workspaceAgentEnabled={caps.workspaceAgent}
      reaperEnabled={caps.reaper}
    />
  )
}
