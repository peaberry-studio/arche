import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIdBySlug: vi.fn(),
  findIntegration: vi.fn(),
  findTeamMemberById: vi.fn(),
  listEnabledNotificationChannels: vi.fn(),
}))

const findIdBySlugMock = mocks.findIdBySlug
const findIntegrationMock = mocks.findIntegration
const findTeamMemberByIdMock = mocks.findTeamMemberById
const listEnabledNotificationChannelsMock = mocks.listEnabledNotificationChannels

vi.mock('@/lib/services', () => ({
  slackService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    listEnabledNotificationChannels: (...args: unknown[]) => listEnabledNotificationChannelsMock(...args),
  },
  userService: {
    findIdBySlug: (...args: unknown[]) => findIdBySlugMock(...args),
    findTeamMemberById: (...args: unknown[]) => findTeamMemberByIdMock(...args),
  },
}))

import {
  resolveAutopilotWorkspaceUserId,
  validateAutopilotSlackNotificationAccess,
} from '@/lib/autopilot/route-auth'
import type { AutopilotSlackNotificationConfig } from '@/lib/autopilot/types'

function notificationConfig(
  targets: AutopilotSlackNotificationConfig['targets'],
): AutopilotSlackNotificationConfig {
  return {
    enabled: true,
    includeSessionLink: true,
    targets,
  }
}

describe('autopilot route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findIntegrationMock.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
    findTeamMemberByIdMock.mockResolvedValue({ id: 'user-2' })
    listEnabledNotificationChannelsMock.mockResolvedValue([
      { channelId: 'C-public', isPrivate: false },
      { channelId: 'C-private', isPrivate: true },
    ])
  })

  it('resolves the workspace owner without lookup when context user owns the slug', async () => {
    const result = await resolveAutopilotWorkspaceUserId('alice', {
      id: 'user-1',
      slug: 'alice',
    })

    expect(result).toBe('user-1')
    expect(findIdBySlugMock).not.toHaveBeenCalled()
  })

  it('resolves another workspace owner by slug', async () => {
    findIdBySlugMock.mockResolvedValue({ id: 'owner-1' })

    const result = await resolveAutopilotWorkspaceUserId('alice', {
      id: 'admin-1',
      slug: 'admin',
    })

    expect(result).toBe('owner-1')
    expect(findIdBySlugMock).toHaveBeenCalledWith('alice')
  })

  it('returns null when the target slug is unknown', async () => {
    findIdBySlugMock.mockResolvedValue(null)

    const result = await resolveAutopilotWorkspaceUserId('missing', {
      id: 'admin-1',
      slug: 'admin',
    })

    expect(result).toBeNull()
  })

  it('allows disabled or empty Slack notification configs', async () => {
    await expect(
      validateAutopilotSlackNotificationAccess(null, { id: 'user-1', role: 'USER' }, 'user-1'),
    ).resolves.toEqual({ ok: true })
    await expect(
      validateAutopilotSlackNotificationAccess(
        { enabled: false, includeSessionLink: true, targets: [] },
        { id: 'user-1', role: 'USER' },
        'user-1',
      ),
    ).resolves.toEqual({ ok: true })
  })

  it('rejects non-admin DM targets outside the task owner', async () => {
    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'dm', userId: 'user-2' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'slack_notification_dm_target_forbidden',
      status: 403,
    })
  })

  it('allows non-admin DM targets for the task owner', async () => {
    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'dm', userId: 'user-1' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({ ok: true })
    expect(findIntegrationMock).not.toHaveBeenCalled()
  })

  it('requires admin DM targets to exist as team members', async () => {
    findTeamMemberByIdMock.mockResolvedValue(null)

    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'dm', userId: 'missing-user' }]),
      { id: 'admin-1', role: 'ADMIN' },
      'owner-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'unknown_slack_notification_dm_target',
      status: 400,
    })
  })

  it('rejects channel targets when Slack integration is disabled', async () => {
    findIntegrationMock.mockResolvedValue({ enabled: false, slackTeamId: 'T123' })

    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'channel', channelId: 'C-public' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'slack_integration_disabled',
      status: 400,
    })
  })

  it('rejects unknown Slack notification channels', async () => {
    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'channel', channelId: 'C-missing' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'unknown_slack_notification_channel_target',
      status: 400,
    })
  })

  it('rejects private channel targets for non-admin users', async () => {
    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([{ type: 'channel', channelId: 'C-private' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'slack_notification_channel_target_forbidden',
      status: 403,
    })
  })

  it('allows valid mixed Slack notification targets', async () => {
    const result = await validateAutopilotSlackNotificationAccess(
      notificationConfig([
        { type: 'dm', userId: 'user-2' },
        { type: 'channel', channelId: 'C-private' },
      ]),
      { id: 'admin-1', role: 'ADMIN' },
      'owner-1',
    )

    expect(result).toEqual({ ok: true })
  })
})
