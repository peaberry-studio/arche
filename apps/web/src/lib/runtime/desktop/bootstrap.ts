import { applyKickstart } from '@/kickstart/apply'
import { getKickstartStatus } from '@/kickstart/status'
import { getKickstartTemplateById } from '@/kickstart/templates'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'

const DEFAULT_DESKTOP_COMPANY_DESCRIPTION = 'Local desktop workspace'

export async function ensureDesktopWorkspaceBootstrapped(actorUserId: string): Promise<void> {
  const vault = getCurrentDesktopVault()
  if (!vault) {
    return
  }

  const status = await getKickstartStatus()
  if (status !== 'needs_setup') {
    return
  }

  const blankTemplate = getKickstartTemplateById('blank')
  if (!blankTemplate) {
    throw new Error('Desktop bootstrap template not found')
  }

  const result = await applyKickstart(
    {
      companyName: vault.vaultName,
      companyDescription: DEFAULT_DESKTOP_COMPANY_DESCRIPTION,
      templateId: blankTemplate.id,
      agents: blankTemplate.recommendedAgentIds.map((id) => ({ id })),
    },
    actorUserId,
  )

  if (!result.ok && result.error !== 'already_configured') {
    throw new Error(result.message ?? result.error)
  }
}
