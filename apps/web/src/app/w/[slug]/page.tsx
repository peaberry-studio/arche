import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { WorkspaceShell } from '@/components/workspace/workspace-shell'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
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
  searchParams?: Promise<{ path?: string }>
}) {
  const { slug } = await params
  const search = await searchParams

  // Verify authentication
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  // Verify authorization: user can only access their own workspace (or admin can access all)
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/w/${session.user.slug}`)
  }

  const kickstartStatus = await getKickstartStatus()
  if (kickstartStatus !== 'ready') {
    const setupParam = kickstartStatus === 'setup_in_progress' ? 'in-progress' : 'required'
    redirect(`/u/${slug}?setup=${setupParam}`)
  }

  const caps = getRuntimeCapabilities()
  const cookieStore = await cookies()
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()
  const initialLayoutCookie = cookieStore.get(getWorkspaceLayoutCookieName(slug))?.value
  const initialLeftPanelCookie = cookieStore.get(getWorkspaceLeftPanelCookieName(slug))?.value
  const initialLayoutState = initialLayoutCookie ? parseWorkspaceLayoutState(initialLayoutCookie) : null
  const initialLeftPanelState = initialLeftPanelCookie
    ? normalizeLeftPanelState(parseStoredLeftPanelState(initialLeftPanelCookie))
    : null

  return (
    <WorkspaceShell
      slug={slug}
      initialFilePath={search?.path ?? null}
      initialLayoutState={initialLayoutState}
      initialLeftPanelState={initialLeftPanelState}
      macDesktopWindowInset={macDesktopWindowInset}
      workspaceAgentEnabled={caps.workspaceAgent}
      reaperEnabled={caps.reaper}
    />
  )
}
