import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
import { getCurrentDesktopVault, getWorkspacePersistenceScope } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
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

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const desktopVault = getCurrentDesktopVault()
  if (isDesktop() && !desktopVault) {
    redirect('/')
  }

  const persistenceScope = getWorkspacePersistenceScope(slug)
  const cookieStore = await cookies()
  const storedChatFontFamily = cookieStore.get(getWorkspaceChatFontFamilyCookieName(persistenceScope))?.value
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(persistenceScope))?.value
  const storedThemeId = cookieStore.get(getWorkspaceThemeCookieName(persistenceScope))?.value
  const storedDarkMode = cookieStore.get(getWorkspaceDarkModeCookieName(persistenceScope))?.value
  const initialChatFontFamily = storedChatFontFamily && isWorkspaceChatFontFamily(storedChatFontFamily)
    ? storedChatFontFamily
    : DEFAULT_CHAT_FONT_FAMILY
  const initialChatFontSize = storedChatFontSize ? Number.parseInt(storedChatFontSize, 10) : Number.NaN

  const initialThemeId = storedThemeId && isWorkspaceThemeId(storedThemeId) ? storedThemeId : DEFAULT_THEME_ID
  const initialIsDark = storedDarkMode === 'true' ? true : storedDarkMode === 'false' ? false : DEFAULT_DARK_MODE

  return (
    <WorkspaceThemeProvider
      key={persistenceScope}
      storageScope={persistenceScope}
      initialChatFontFamily={initialChatFontFamily}
      initialChatFontSize={isWorkspaceChatFontSize(initialChatFontSize) ? initialChatFontSize : DEFAULT_CHAT_FONT_SIZE}
      initialIsDark={initialIsDark}
      initialThemeId={initialThemeId}
    >
      {children}
    </WorkspaceThemeProvider>
  );
}
