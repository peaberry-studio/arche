import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { get2FAStatus } from '@/app/u/[slug]/settings/security/actions'
import { normalizeTwoFactorStatus } from '@/app/u/[slug]/settings/security/status'
import { WorkspaceAppChrome } from '@/components/workspace/workspace-app-chrome'
import { WorkspaceSettingsDialog } from '@/components/workspace/workspace-settings-dialog'
import { WorkspaceRuntimeProvider } from '@/contexts/workspace-runtime-context'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'
import type { GoogleWorkspaceIntegrationSummary } from '@/lib/google-workspace/types'
import { getPublicBaseUrl } from '@/lib/http'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getWorkspacePersistenceScope } from '@/lib/runtime/desktop/current-vault'
import { shouldUseCurrentMacOsInsetTitleBar } from '@/lib/runtime/desktop-window-chrome'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { googleWorkspaceService, kbGithubRemoteService, slackService } from '@/lib/services'
import { serializeSlackIntegration } from '@/lib/slack/integration'
import type { SlackIntegrationSummary } from '@/lib/slack/types'
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

async function loadSlackIntegrationSummary(): Promise<SlackIntegrationSummary | null> {
  const integration = await slackService.findIntegration()
  if (!integration) return null
  return serializeSlackIntegration(integration, null)
}

async function loadGoogleWorkspaceSummary(): Promise<GoogleWorkspaceIntegrationSummary | null> {
  const record = await googleWorkspaceService.ensureIntegrationSeededFromEnv()
  const config = record ? googleWorkspaceService.decryptIntegrationConfig(record) : null
  return {
    clientId: config?.clientId ?? null,
    configured: Boolean(config?.clientId && config?.clientSecret),
    hasClientSecret: Boolean(config?.clientSecret),
    version: record?.version ?? 0,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

async function loadKbGithubRemoteSummary(): Promise<KbGithubRemoteIntegrationSummary | null> {
  const record = await kbGithubRemoteService.findIntegration()
  if (!record) return null
  const config = kbGithubRemoteService.decryptIntegrationConfig(record)
  return kbGithubRemoteService.toSummary(record, config)
}

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
  const caps = getRuntimeCapabilities()
  const reaperEnabled = caps.reaper
  const macDesktopWindowInset = shouldUseCurrentMacOsInsetTitleBar()
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

  const session = await getSession()
  if (!session) {
    redirect('/login')
  }

  const isAdmin = session.user.role === 'ADMIN'
  const [status, slackIntegrationSummary, googleWorkspaceSummary, kbGithubRemoteSummary] = await Promise.all([
    caps.twoFactor ? get2FAStatus() : Promise.resolve(null),
    caps.slackIntegration && isAdmin
      ? loadSlackIntegrationSummary()
      : Promise.resolve<SlackIntegrationSummary | null>(null),
    caps.googleWorkspaceIntegration && isAdmin
      ? loadGoogleWorkspaceSummary()
      : Promise.resolve<GoogleWorkspaceIntegrationSummary | null>(null),
    caps.kbGithubRemoteIntegration && isAdmin
      ? loadKbGithubRemoteSummary()
      : Promise.resolve<KbGithubRemoteIntegrationSummary | null>(null),
  ])
  const { enabled: twoFactorEnabledStatus, verifiedAt: twoFactorVerifiedAt, recoveryCodesRemaining } =
    normalizeTwoFactorStatus(status)

  const requestHeaders = await headers()
  const publicBaseUrl = getPublicBaseUrl(requestHeaders, 'http://localhost:3000')
  const googleWorkspaceRedirectUri = `${publicBaseUrl}/api/connectors/oauth/callback`

  return (
    <WorkspaceThemeProvider
      key={persistenceScope}
      storageScope={persistenceScope}
      initialChatFontFamily={initialChatFontFamily}
      initialChatFontSize={isWorkspaceChatFontSize(initialChatFontSize) ? initialChatFontSize : DEFAULT_CHAT_FONT_SIZE}
      initialIsDark={initialIsDark}
      initialThemeId={initialThemeId}
    >
      <WorkspaceRuntimeProvider
        slug={slug}
        persistenceScope={persistenceScope}
        reaperEnabled={reaperEnabled}
      >
        <WorkspaceAppChrome
          slug={slug}
          persistenceScope={persistenceScope}
          currentVault={desktopVault ? { id: desktopVault.vaultId, name: desktopVault.vaultName, path: desktopVault.vaultPath } : null}
          macDesktopWindowInset={macDesktopWindowInset}
        >
          {children}
        </WorkspaceAppChrome>
        <WorkspaceSettingsDialog
          slug={slug}
          caps={caps}
          isAdmin={isAdmin}
          currentUserId={session.user.id}
          currentUserEmail={session.user.email ?? ''}
          currentUserSlug={session.user.slug}
          googleWorkspaceRedirectUri={googleWorkspaceRedirectUri}
          passwordChangeEnabled={caps.auth}
          twoFactorEnabled={caps.twoFactor}
          twoFactorEnabledStatus={twoFactorEnabledStatus}
          twoFactorVerifiedAt={twoFactorVerifiedAt}
          recoveryCodesRemaining={recoveryCodesRemaining}
          slackIntegrationSummary={slackIntegrationSummary}
          googleWorkspaceSummary={googleWorkspaceSummary}
          kbGithubRemoteSummary={kbGithubRemoteSummary}
        />
      </WorkspaceRuntimeProvider>
    </WorkspaceThemeProvider>
  );
}
