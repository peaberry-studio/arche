import { cookies } from 'next/headers'

import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
import { DEFAULT_THEME_ID, getWorkspaceThemeCookieName, isWorkspaceThemeId } from '@/lib/workspace-theme'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cookieStore = await cookies()
  const storedThemeId = cookieStore.get(getWorkspaceThemeCookieName(slug))?.value
  const initialThemeId = storedThemeId && isWorkspaceThemeId(storedThemeId)
    ? storedThemeId
    : DEFAULT_THEME_ID

  return (
    <WorkspaceThemeProvider key={slug} storageScope={slug} initialThemeId={initialThemeId}>
      {children}
    </WorkspaceThemeProvider>
  );
}
