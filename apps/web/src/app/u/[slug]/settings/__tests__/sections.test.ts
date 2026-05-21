import { describe, expect, it } from 'vitest'

import { getAvailableSettingsSections } from '../sections'

describe('getAvailableSettingsSections', () => {
  it('includes admin sections and keeps integrations when MCP is the only integration capability', () => {
    expect(
      getAvailableSettingsSections({
        isAdmin: true,
        mcpAvailable: true,
        passwordChangeEnabled: false,
        slackIntegrationEnabled: false,
        googleWorkspaceIntegrationEnabled: false,
        kbGithubRemoteIntegrationEnabled: false,
        twoFactorEnabled: false,
      }),
    ).toEqual(['general', 'providers', 'analytics', 'team', 'integrations'])
  })

  it('keeps the team section for regular users without exposing unavailable sections', () => {
    expect(
      getAvailableSettingsSections({
        isAdmin: false,
        mcpAvailable: false,
        passwordChangeEnabled: false,
        slackIntegrationEnabled: false,
        googleWorkspaceIntegrationEnabled: false,
        kbGithubRemoteIntegrationEnabled: false,
        twoFactorEnabled: false,
      }),
    ).toEqual(['general', 'team'])
  })
})
