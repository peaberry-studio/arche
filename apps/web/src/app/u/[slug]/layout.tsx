import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { DashboardThemeShell } from '@/components/dashboard/dashboard-theme-shell'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'
import { getCurrentDesktopVault, getWorkspacePersistenceScope } from '@/lib/runtime/desktop/current-vault'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { cn } from '@/lib/utils'
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
  const desktopVault = getCurrentDesktopVault()

  if (isDesktop() && !desktopVault) {
    redirect('/')
  }

  const persistenceScope = getWorkspacePersistenceScope(slug)

  const cookieStore = await cookies()
  const storedChatFontFamily = cookieStore.get(getWorkspaceChatFontFamilyCookieName(persistenceScope))?.value
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(persistenceScope))?.value

  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  const storedThemeId = cookieStore.get(getWorkspaceThemeCookieName(persistenceScope))?.value
  const storedDarkMode = cookieStore.get(getWorkspaceDarkModeCookieName(persistenceScope))?.value
  const initialChatFontFamily = storedChatFontFamily && isWorkspaceChatFontFamily(storedChatFontFamily)
    ? storedChatFontFamily
    : DEFAULT_CHAT_FONT_FAMILY
  const initialChatFontSize = storedChatFontSize ? Number.parseInt(storedChatFontSize, 10) : Number.NaN

  const initialThemeId = storedThemeId && isWorkspaceThemeId(storedThemeId) ? storedThemeId : DEFAULT_THEME_ID
  const initialIsDark = storedDarkMode === 'true' ? true : storedDarkMode === 'false' ? false : DEFAULT_DARK_MODE
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()

  return (
    <WorkspaceThemeProvider
      key={persistenceScope}
      storageScope={persistenceScope}
      initialChatFontFamily={initialChatFontFamily}
      initialChatFontSize={isWorkspaceChatFontSize(initialChatFontSize) ? initialChatFontSize : DEFAULT_CHAT_FONT_SIZE}
      initialIsDark={initialIsDark}
      initialThemeId={initialThemeId}
    >
      <DashboardThemeShell>
        {macDesktopWindowInset && (
          <div className="desktop-titlebar-drag absolute inset-x-0 top-0 z-50 h-8" />
        )}
        <div
          className={cn(
            'mx-auto max-w-6xl px-6',
            macDesktopWindowInset ? 'pt-10' : 'pt-6',
            macDesktopWindowInset && 'desktop-no-select',
          )}
        >
          <DashboardNav
            slug={slug}
            desktopMode={Boolean(desktopVault)}
            displayLabel={desktopVault?.vaultName}
          />
        </div>

        {children}
      </DashboardThemeShell>
    </WorkspaceThemeProvider>
  )
}
