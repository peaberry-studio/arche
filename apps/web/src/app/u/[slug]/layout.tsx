import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { DashboardThemeShell } from '@/components/dashboard/dashboard-theme-shell'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'
import { getSession } from '@/lib/runtime/session'
import {
  DEFAULT_CHAT_FONT_FAMILY,
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_DARK_MODE,
  DEFAULT_THEME_ID,
  getWorkspaceChatFontFamilyCookieName,
  getWorkspaceChatFontSizeCookieName,
  getWorkspaceDarkModeCookieName,
  getWorkspaceThemeCookieName,
  isWorkspaceChatFontFamily,
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
  const storedChatFontFamily = cookieStore.get(getWorkspaceChatFontFamilyCookieName(slug))?.value
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(slug))?.value

  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  const storedThemeId = cookieStore.get(getWorkspaceThemeCookieName(slug))?.value
  const storedDarkMode = cookieStore.get(getWorkspaceDarkModeCookieName(slug))?.value
  const initialChatFontFamily = storedChatFontFamily && isWorkspaceChatFontFamily(storedChatFontFamily)
    ? storedChatFontFamily
    : DEFAULT_CHAT_FONT_FAMILY
  const initialChatFontSize = storedChatFontSize ? Number.parseInt(storedChatFontSize, 10) : Number.NaN

  const initialThemeId = storedThemeId && isWorkspaceThemeId(storedThemeId) ? storedThemeId : DEFAULT_THEME_ID
  const initialIsDark = storedDarkMode === 'true' ? true : storedDarkMode === 'false' ? false : DEFAULT_DARK_MODE

  return (
    <WorkspaceThemeProvider
      key={slug}
      storageScope={slug}
      initialChatFontFamily={initialChatFontFamily}
      initialChatFontSize={isWorkspaceChatFontSize(initialChatFontSize) ? initialChatFontSize : DEFAULT_CHAT_FONT_SIZE}
      initialIsDark={initialIsDark}
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
