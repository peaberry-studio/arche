'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { useWorkspaceRuntime } from '@/contexts/workspace-runtime-context'
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import { cn } from '@/lib/utils'
import {
  getWorkspaceCatalogHref,
  getWorkspaceFlowsHref,
  getWorkspaceHref,
} from '@/lib/workspace-hrefs'

import { WorkspaceAccountMenu } from './workspace-account-menu'
import { WorkspaceMobileNav } from './workspace-mobile-nav'
import { WorkspaceSidebar } from './workspace-sidebar'

type WorkspaceAppChromeProps = {
  children: ReactNode
  currentVault?: {
    id: string
    name: string
    path: string
  } | null
  macDesktopWindowInset?: boolean
  slug: string
}

export function WorkspaceAppChrome({
  children,
  currentVault = null,
  macDesktopWindowInset = false,
  slug,
}: WorkspaceAppChromeProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { themeId, isDark } = useWorkspaceTheme()
  const {
    curatorOpen,
    knowledgePendingCount,
    knowledgePublishCount,
    refreshKnowledgePendingCount,
    sessionsHook,
    setCuratorOpen,
    setSidebarCollapsed,
    sidebarCollapsed,
  } = useWorkspaceRuntime()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const catalogParam = searchParams?.get('catalog')
  const flowsParam = searchParams?.get('flows')
  const isExploreRoute = pathname === `/w/${slug}/explore`
  const isChatRoute = pathname === `/w/${slug}`
  const hasManagementParams = Boolean(catalogParam || flowsParam)
  const isChatActive = isChatRoute && !hasManagementParams && !curatorOpen
  const curatorBadgeCount = knowledgePendingCount + knowledgePublishCount

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false)
      }
    }
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileMenuOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [mobileMenuOpen])

  const openCurator = useCallback(() => {
    setCuratorOpen(true)
    void refreshKnowledgePendingCount()
  }, [refreshKnowledgePendingCount, setCuratorOpen])

  const navigateSettings = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceHref(slug, { settings: 'general' }))
  }, [closeMobileMenu, router, slug])

  const navigateConnectors = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceHref(slug, { settings: 'connectors' }))
  }, [closeMobileMenu, router, slug])

  const navigateProviders = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceHref(slug, { settings: 'providers' }))
  }, [closeMobileMenu, router, slug])

  const handleOpenFlowsManager = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceFlowsHref(slug, 'list'))
  }, [closeMobileMenu, router, slug])

  const navigateAgents = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceCatalogHref(slug, 'agents'))
  }, [closeMobileMenu, router, slug])

  const navigateSkills = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceCatalogHref(slug, 'skills'))
  }, [closeMobileMenu, router, slug])

  const handleOpenExplore = useCallback(() => {
    closeMobileMenu()
    router.push(getWorkspaceHref(slug, { mode: 'explore' }))
  }, [closeMobileMenu, router, slug])

  const handleOpenCurator = useCallback(() => {
    closeMobileMenu()
    openCurator()
  }, [closeMobileMenu, openCurator])

  const handleCreateSession = useCallback(() => {
    closeMobileMenu()
    sessionsHook.selectSession(null)
    // New chat is the empty composer, not an OpenCode session. The session
    // is created when the first message is sent. Always land on the workspace
    // root so catalog/flows/explore state is cleared and ?session= is dropped.
    router.push(getWorkspaceHref(slug))
  }, [closeMobileMenu, router, sessionsHook, slug])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      closeMobileMenu()
      sessionsHook.selectSession(sessionId)
      // Selecting a session is the way back from explore and management
      // surfaces; on the plain chat route the state-only select is enough.
      if (!isChatRoute || hasManagementParams) {
        router.push(getWorkspaceHref(slug, { sessionId }))
      }
    },
    [closeMobileMenu, hasManagementParams, isChatRoute, router, sessionsHook, slug]
  )

  const handleShowChat = useCallback(() => {
    closeMobileMenu()
    setCuratorOpen(false)
    if (isChatRoute && !hasManagementParams) return
    const sessionId = sessionsHook.activeSessionId
    router.push(getWorkspaceHref(slug, sessionId ? { sessionId } : {}))
  }, [closeMobileMenu, hasManagementParams, isChatRoute, router, sessionsHook.activeSessionId, setCuratorOpen, slug])

  const handleMobileKnowledge = useCallback(() => {
    closeMobileMenu()
    setCuratorOpen(false)
    if (isExploreRoute) return
    handleOpenExplore()
  }, [closeMobileMenu, handleOpenExplore, isExploreRoute, setCuratorOpen])

  const handleMobileCurator = useCallback(() => {
    closeMobileMenu()
    if (curatorOpen) {
      setCuratorOpen(false)
      return
    }
    openCurator()
  }, [closeMobileMenu, curatorOpen, openCurator, setCuratorOpen])

  const handleToggleCollapsed = useCallback(() => {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false)
      return
    }
    setSidebarCollapsed((previous) => !previous)
  }, [mobileMenuOpen, setSidebarCollapsed])

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
      isCollapsed={mobileMenuOpen ? false : sidebarCollapsed}
      isInitialSessionsReady={sessionsHook.isInitialSessionsReady}
      isLoadingMoreSessions={sessionsHook.isLoadingMoreSessions}
      knowledgePendingCount={knowledgePendingCount + knowledgePublishCount}
      macDesktopWindowInset={macDesktopWindowInset}
      onCreateSession={handleCreateSession}
      onLoadMoreSessions={sessionsHook.loadMoreSessions}
      onMarkFlowRunSeen={sessionsHook.markFlowRunSeen}
      onNavAgents={navigateAgents}
      onNavCurator={handleOpenCurator}
      onNavExplore={handleOpenExplore}
      onNavFlows={handleOpenFlowsManager}
      onNavSkills={navigateSkills}
      onSelectSession={handleSelectSession}
      onToggleCollapsed={handleToggleCollapsed}
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
        {mobileMenuOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-label="Close menu"
            onClick={closeMobileMenu}
          />
        ) : null}
        <div
          className={cn(
            'overflow-hidden border-r border-border/30 bg-background transition-[width] duration-200',
            mobileMenuOpen
              ? 'fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] shadow-xl'
              : cn('hidden shrink-0 md:block', sidebarCollapsed ? 'w-12' : 'w-60'),
          )}
        >
          {sidebarElement}
        </div>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <WorkspaceMobileNav
        chatActive={isChatActive}
        curatorActive={curatorOpen}
        curatorBadgeCount={curatorBadgeCount}
        knowledgeActive={isExploreRoute && !curatorOpen}
        menuActive={mobileMenuOpen || hasManagementParams}
        onChat={handleShowChat}
        onCurator={handleMobileCurator}
        onKnowledge={handleMobileKnowledge}
        onMenu={() => setMobileMenuOpen((open) => !open)}
      />
    </div>
  )
}
