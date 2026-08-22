export const WORKSPACE_SETTINGS_SECTIONS = [
  'general',
  'providers',
  'connectors',
  'team',
  'integrations',
  'security',
  'analytics',
] as const

export type WorkspaceSettingsSection = (typeof WORKSPACE_SETTINGS_SECTIONS)[number]

export function isWorkspaceSettingsSection(
  value: string | null | undefined,
): value is WorkspaceSettingsSection {
  return WORKSPACE_SETTINGS_SECTIONS.includes(value as WorkspaceSettingsSection)
}
