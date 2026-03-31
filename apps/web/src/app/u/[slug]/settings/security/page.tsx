import { redirect } from 'next/navigation'

import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { getSession } from '@/lib/runtime/session'
import { get2FAStatus } from './actions'
import { normalizeTwoFactorStatus } from './status'
import { SettingsPageContent } from './settings-page-content'

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params

  const session = await getSession()
  if (!session) redirect('/login')

  const caps = getRuntimeCapabilities()
  const status = caps.twoFactor ? await get2FAStatus() : null
  if (caps.twoFactor && (!status || !status.ok)) redirect('/login')

  const { enabled, verifiedAt, recoveryCodesRemaining } = normalizeTwoFactorStatus(status)
  const releaseVersion =
    process.env.ARCHE_GIT_SHA?.trim() ||
    process.env.ARCHE_RELEASE_VERSION?.trim() ||
    'dev'

  return (
    <SettingsPageContent
      passwordChangeEnabled={caps.auth}
      twoFactorEnabled={caps.twoFactor}
      enabled={enabled}
      verifiedAt={verifiedAt}
      recoveryCodesRemaining={recoveryCodesRemaining}
      releaseVersion={releaseVersion}
    />
  )
}
