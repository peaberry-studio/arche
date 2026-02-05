import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    redirect('/login')
  }

  const session = await getSessionFromToken(token)
  if (!session) {
    redirect('/login')
  }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <div className="relative mx-auto max-w-6xl px-6 pt-6">
        <DashboardNav slug={slug} />
      </div>

      {children}
    </div>
  )
}
