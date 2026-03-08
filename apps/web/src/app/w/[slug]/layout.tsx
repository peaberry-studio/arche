import { cookies } from 'next/headers'

import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
import {
  DEFAULT_CHAT_FONT_SIZE,
  DEFAULT_THEME_ID,
  getWorkspaceChatFontSizeCookieName,
  getWorkspaceThemeCookieName,
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
  const storedChatFontSize = cookieStore.get(getWorkspaceChatFontSizeCookieName(slug))?.value
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
      {children}
    </WorkspaceThemeProvider>
  );
}
