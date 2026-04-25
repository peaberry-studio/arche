export const SETTINGS_SECTIONS = [
  'general',
  'integrations',
  'security',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  integrations: 'Integrations',
  security: 'Security',
}

type SettingsSectionAvailability = {
  isAdmin: boolean
  passwordChangeEnabled: boolean
  slackIntegrationEnabled: boolean
  googleWorkspaceIntegrationEnabled: boolean
  twoFactorEnabled: boolean
}

export function getAvailableSettingsSections({
  isAdmin,
  passwordChangeEnabled,
  slackIntegrationEnabled,
  googleWorkspaceIntegrationEnabled,
  twoFactorEnabled,
}: SettingsSectionAvailability): SettingsSection[] {
  const sections: SettingsSection[] = ['general']

  if (isAdmin && (slackIntegrationEnabled || googleWorkspaceIntegrationEnabled)) {
    sections.push('integrations')
  }

  if (passwordChangeEnabled || twoFactorEnabled) {
    sections.push('security')
  }

  return sections
}

export function resolveSettingsSection(
  section: string | undefined,
  availableSections: SettingsSection[],
): SettingsSection {
  if (section && isSettingsSection(section) && availableSections.includes(section)) {
    return section
  }

  return availableSections[0] ?? 'general'
}

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection)
}
