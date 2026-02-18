import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'
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
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  
  if (!token) {
    redirect('/login')
  }

  const session = await getSessionFromToken(token)
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

  return (
    <WorkspaceShell
      slug={slug}
      initialFilePath={search?.path ?? null}
    />
  )
}
