import { redirect } from 'next/navigation'

import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'
import { serializeSlackIntegration } from '@/lib/slack/integration'
import type { SlackIntegrationSummary } from '@/lib/slack/types'
import { slackService, googleWorkspaceService } from '@/lib/services'
import type { GoogleWorkspaceIntegrationSummary } from '@/lib/google-workspace/types'
import { get2FAStatus } from './security/actions'
import { normalizeTwoFactorStatus } from './security/status'
import { SettingsPageContent } from './settings-page-content'
import { getAvailableSettingsSections, resolveSettingsSection } from './sections'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) redirect('/')
    redirect(getDesktopWorkspaceHref('local', 'appearance'))
  }

  const session = await getSession()
  if (!session) redirect('/login')

  const caps = getRuntimeCapabilities()
  const [status, slackIntegrationSummary, googleWorkspaceSummary] = await Promise.all([
    caps.twoFactor ? get2FAStatus() : Promise.resolve(null),
    caps.slackIntegration && session.user.role === 'ADMIN'
      ? loadSlackIntegrationSummary()
      : Promise.resolve<SlackIntegrationSummary | null>(null),
    caps.googleWorkspaceIntegration && session.user.role === 'ADMIN'
      ? loadGoogleWorkspaceSummary()
      : Promise.resolve<GoogleWorkspaceIntegrationSummary | null>(null),
  ])

  if (caps.twoFactor && (!status || !status.ok)) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = normalizeTwoFactorStatus(status)
  const availableSections = getAvailableSettingsSections({
    isAdmin: session.user.role === 'ADMIN',
    passwordChangeEnabled: caps.auth,
    slackIntegrationEnabled: caps.slackIntegration,
    googleWorkspaceIntegrationEnabled: caps.googleWorkspaceIntegration,
    twoFactorEnabled: caps.twoFactor,
  })
  const search = await searchParams
  const sectionValue = Array.isArray(search.section) ? search.section[0] : search.section
  const currentSection = resolveSettingsSection(sectionValue, availableSections)
  const releaseVersion =
    process.env.ARCHE_GIT_SHA?.trim() ||
    process.env.ARCHE_RELEASE_VERSION?.trim() ||
    'dev'

  return (
    <SettingsPageContent
      slug={slug}
      availableSections={availableSections}
      currentSection={currentSection}
      passwordChangeEnabled={caps.auth}
      twoFactorEnabled={caps.twoFactor}
      enabled={enabled}
      verifiedAt={verifiedAt}
      recoveryCodesRemaining={recoveryCodesRemaining}
      releaseVersion={releaseVersion}
      slackIntegrationSummary={slackIntegrationSummary}
      googleWorkspaceSummary={googleWorkspaceSummary}
    />
  )
}

async function loadSlackIntegrationSummary(): Promise<SlackIntegrationSummary> {
  const integration = await slackService.findIntegration()
  return serializeSlackIntegration(integration, null)
}

async function loadGoogleWorkspaceSummary(): Promise<GoogleWorkspaceIntegrationSummary> {
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
