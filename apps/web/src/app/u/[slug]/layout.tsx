import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { DashboardThemeShell } from '@/components/dashboard/dashboard-theme-shell'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'
import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import {
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_THEME_ID,
  getWorkspaceChatFontSizeCookieName,
  getWorkspaceThemeCookieName,
  isWorkspaceChatFontSize,
  isWorkspaceThemeId,
} from '@/lib/workspace-theme'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const cookieStore = await cookies()
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(slug))?.value
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

  const storedThemeId = cookieStore.get(getWorkspaceThemeCookieName(slug))?.value
  const initialChatFontSize = storedChatFontSize ? Number.parseInt(storedChatFontSize, 10) : Number.NaN
  const initialThemeId = storedThemeId && isWorkspaceThemeId(storedThemeId)
    ? storedThemeId
    : DEFAULT_THEME_ID

  return (
    <WorkspaceThemeProvider
      key={slug}
      storageScope={slug}
      initialChatFontSize={isWorkspaceChatFontSize(initialChatFontSize) ? initialChatFontSize : DEFAULT_CHAT_FONT_SIZE}
      initialThemeId={initialThemeId}
    >
      <DashboardThemeShell>
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <DashboardNav slug={slug} />
        </div>

        {children}
      </DashboardThemeShell>
    </WorkspaceThemeProvider>
  )
}
