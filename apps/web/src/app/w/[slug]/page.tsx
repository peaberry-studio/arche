import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'

export default async function WorkspaceHostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ path?: string }>
}) {
  const { slug } = await params
  const search = await searchParams

  // Verificar autenticación
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  
  if (!token) {
    redirect('/login')
  }

  const session = await getSessionFromToken(token)
  if (!session) {
    redirect('/login')
  }

  // Verificar autorización: el usuario solo puede ver su propio workspace (o admin puede ver todos)
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/w/${session.user.slug}`)
  }

  return (
    <WorkspaceShell
      slug={slug}
      initialFilePath={search?.path ?? null}
    />
  )
}
