export const SETTINGS_SECTIONS = [
  'appearance',
  'integrations',
  'security',
  'advanced',
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  appearance: 'Look & Feel',
  integrations: 'Integrations',
  security: 'Security',
  advanced: 'Advanced',
}

type SettingsSectionAvailability = {
  isAdmin: boolean
  passwordChangeEnabled: boolean
  slackIntegrationEnabled: boolean
  twoFactorEnabled: boolean
}

export function getAvailableSettingsSections({
  isAdmin,
  passwordChangeEnabled,
  slackIntegrationEnabled,
  twoFactorEnabled,
}: SettingsSectionAvailability): SettingsSection[] {
  const sections: SettingsSection[] = ['appearance']

  if (slackIntegrationEnabled && isAdmin) {
    sections.push('integrations')
  }

  if (passwordChangeEnabled || twoFactorEnabled) {
    sections.push('security')
  }

  sections.push('advanced')

  return sections
}

export function resolveSettingsSection(
  section: string | undefined,
  availableSections: SettingsSection[],
): SettingsSection {
  if (section && isSettingsSection(section) && availableSections.includes(section)) {
    return section
  }

  return availableSections[0] ?? 'appearance'
}

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection)
}
