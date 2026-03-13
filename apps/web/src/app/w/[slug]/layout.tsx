import { cookies } from 'next/headers'

import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
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
  const cookieStore = await cookies()
  const storedChatFontFamily = cookieStore.get(getWorkspaceChatFontFamilyCookieName(slug))?.value
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(slug))?.value
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
      {children}
    </WorkspaceThemeProvider>
  );
}
