'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { useWorkspaceRuntime } from '@/contexts/workspace-runtime-context'
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import {
  getWorkspaceCatalogHref,
  getWorkspaceFlowsHref,
  getWorkspaceHref,
} from '@/lib/workspace-hrefs'
import { cn } from '@/lib/utils'

import { WorkspaceAccountMenu } from './workspace-account-menu'
import { WorkspaceSidebar } from './workspace-sidebar'

type WorkspaceAppChromeProps = {
  children: ReactNode
  currentVault?: {
    id: string
    name: string
    path: string
  } | null
  macDesktopWindowInset?: boolean
  persistenceScope: string
  slug: string
}

export function WorkspaceAppChrome({
  children,
  currentVault = null,
  macDesktopWindowInset = false,
  persistenceScope,
  slug,
}: WorkspaceAppChromeProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { themeId, isDark } = useWorkspaceTheme()
  const {
    curatorOpen,
    knowledgePendingCount,
    refreshKnowledgePendingCount,
    sessionsHook,
    setCuratorOpen,
    setSidebarCollapsed,
    sidebarCollapsed,
  } = useWorkspaceRuntime()

  const openCurator = useCallback(() => {
    setCuratorOpen(true)
    void refreshKnowledgePendingCount()
  }, [refreshKnowledgePendingCount, setCuratorOpen])

  const navigateSettings = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'general' }))
  }, [router, slug])

  const navigateConnectors = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'connectors' }))
  }, [router, slug])

  const navigateProviders = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'providers' }))
  }, [router, slug])

  const handleOpenFlowsManager = useCallback(() => {
    router.push(getWorkspaceFlowsHref(slug, 'list'))
  }, [router, slug])

  const navigateAgents = useCallback(() => {
    router.push(getWorkspaceCatalogHref(slug, 'agents'))
  }, [router, slug])

  const navigateSkills = useCallback(() => {
    router.push(getWorkspaceCatalogHref(slug, 'skills'))
  }, [router, slug])

  const handleOpenExplore = useCallback(() => {
    router.push(getWorkspaceHref(slug, { mode: 'explore' }))
  }, [router, slug])

  const handleCreateSession = useCallback(() => {
    sessionsHook.selectSession(null)
    // New chat is the empty composer, not an OpenCode session. The session
    // is created when the first message is sent. Always land on the workspace
    // root so catalog/flows/explore state is cleared and ?session= is dropped.
    router.push(getWorkspaceHref(slug))
  }, [router, sessionsHook, slug])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      sessionsHook.selectSession(sessionId)
      // Selecting a session is the way back from explore and management
      // surfaces; on the plain chat route the state-only select is enough.
      const isChatRoute = pathname === `/w/${slug}`
      const hasManagementParams = Boolean(searchParams?.get('catalog') || searchParams?.get('flows'))
      if (!isChatRoute || hasManagementParams) {
        router.push(getWorkspaceHref(slug, { sessionId }))
      }
    },
    [pathname, router, searchParams, sessionsHook, slug]
  )

  const sidebarElement = (
    <WorkspaceSidebar
      activeSessionId={sessionsHook.activeSessionId}
      accountMenu={(collapsed) => (
        <WorkspaceAccountMenu
          slug={slug}
          currentVault={currentVault}
          status="active"
          collapsed={collapsed}
          onNavigateConnectors={navigateConnectors}
          onNavigateProviders={navigateProviders}
          onNavigateSettings={navigateSettings}
        />
      )}
      curatorOpen={curatorOpen}
      hasMoreSessions={sessionsHook.hasMoreSessions}
      isCollapsed={sidebarCollapsed}
      isInitialSessionsReady={sessionsHook.isInitialSessionsReady}
      isLoadingMoreSessions={sessionsHook.isLoadingMoreSessions}
      knowledgePendingCount={knowledgePendingCount}
      macDesktopWindowInset={macDesktopWindowInset}
      onCreateSession={handleCreateSession}
      onLoadMoreSessions={sessionsHook.loadMoreSessions}
      onMarkFlowRunSeen={sessionsHook.markFlowRunSeen}
      onNavAgents={navigateAgents}
      onNavCurator={openCurator}
      onNavExplore={handleOpenExplore}
      onNavFlows={handleOpenFlowsManager}
      onNavSkills={navigateSkills}
      onSelectSession={handleSelectSession}
      onToggleCollapsed={() => setSidebarCollapsed((previous) => !previous)}
      sessions={sessionsHook.sessions}
      sessionsError={sessionsHook.sessionsError}
      unseenCompletedSessions={sessionsHook.unseenCompletedSessions}
    />
  )

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && 'desktop-no-select',
        isDark && 'dark',
        `theme-${themeId}`,
      )}
    >
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'hidden shrink-0 overflow-hidden border-r border-border/30 transition-[width] duration-200 md:block',
            sidebarCollapsed ? 'w-12' : 'w-60',
          )}
        >
          {sidebarElement}
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
