import { describe, expect, it } from 'vitest'

import { getAvailableSettingsSections } from '../sections'

describe('getAvailableSettingsSections', () => {
  it('keeps the integrations section available when MCP is the only integration capability', () => {
    expect(
      getAvailableSettingsSections({
        isAdmin: true,
        mcpAvailable: true,
        passwordChangeEnabled: false,
        slackIntegrationEnabled: false,
        twoFactorEnabled: false,
      }),
    ).toEqual(['general', 'integrations'])
  })
})
