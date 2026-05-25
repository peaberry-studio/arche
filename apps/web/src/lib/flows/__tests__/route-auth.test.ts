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

import { resolveFlowRouteContext } from '@/lib/flows/api'
import { validateFlowSlackNodeAccess } from '@/lib/flows/route-auth'
import type { FlowDefinition, FlowSlackTarget } from '@/lib/flows/types'

function definitionWithSlackTargets(targets: FlowSlackTarget[]): FlowDefinition {
  return {
    edges: [],
    nodes: targets.map((target, index) => ({
      id: `slack-${index}`,
      messageMode: 'fixed',
      messageTemplate: 'Hello',
      name: `Slack ${index}`,
      target,
      type: 'slack',
    })),
    startNodeId: 'slack-0',
    version: 1,
  }
}

describe('flow route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findIntegrationMock.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
    findTeamMemberByIdMock.mockResolvedValue({ id: 'user-2' })
    listEnabledNotificationChannelsMock.mockResolvedValue([
      { channelId: 'C-public', isPrivate: false },
      { channelId: 'C-private', isPrivate: true },
    ])
  })

  it('resolves the route context without lookup when the actor owns the slug', async () => {
    const result = await resolveFlowRouteContext('alice', {
      id: 'user-1',
      role: 'USER',
      slug: 'alice',
    })

    expect(result).toMatchObject({ actorUserId: 'user-1', workspaceUserId: 'user-1' })
    expect(findIdBySlugMock).not.toHaveBeenCalled()
  })

  it('does not resolve another route workspace for members', async () => {
    const result = await resolveFlowRouteContext('alice', {
      id: 'user-2',
      role: 'USER',
      slug: 'bob',
    })

    expect(result).toBeNull()
    expect(findIdBySlugMock).not.toHaveBeenCalled()
  })

  it('resolves another route workspace by slug', async () => {
    findIdBySlugMock.mockResolvedValue({ id: 'owner-1' })

    const result = await resolveFlowRouteContext('alice', {
      id: 'admin-1',
      role: 'ADMIN',
      slug: 'admin',
    })

    expect(result).toMatchObject({ actorUserId: 'admin-1', workspaceUserId: 'owner-1' })
    expect(findIdBySlugMock).toHaveBeenCalledWith('alice')
  })

  it('returns null when the target slug is unknown', async () => {
    findIdBySlugMock.mockResolvedValue(null)

    const result = await resolveFlowRouteContext('missing', {
      id: 'admin-1',
      role: 'ADMIN',
      slug: 'admin',
    })

    expect(result).toBeNull()
  })

  it('allows flows without Slack nodes', async () => {
    await expect(
      validateFlowSlackNodeAccess(null, { id: 'user-1', role: 'USER' }, 'user-1'),
    ).resolves.toEqual({ ok: true })
    await expect(
      validateFlowSlackNodeAccess(
        { edges: [], nodes: [], startNodeId: '', version: 1 },
        { id: 'user-1', role: 'USER' },
        'user-1',
      ),
    ).resolves.toEqual({ ok: true })
  })

  it('rejects non-admin DM targets outside the flow owner', async () => {
    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'dm', userId: 'user-2' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({
      ok: false,
      error: 'slack_notification_dm_target_forbidden',
      status: 403,
    })
  })

  it('allows non-admin DM targets for the flow owner', async () => {
    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'dm', userId: 'user-1' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )

    expect(result).toEqual({ ok: true })
    expect(findIntegrationMock).toHaveBeenCalled()
  })

  it('requires admin DM targets to exist as team members', async () => {
    findTeamMemberByIdMock.mockResolvedValue(null)

    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'dm', userId: 'missing-user' }]),
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

    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'channel', channelId: 'C-public' }]),
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
    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'channel', channelId: 'C-missing' }]),
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
    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([{ type: 'channel', channelId: 'C-private' }]),
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
    const result = await validateFlowSlackNodeAccess(
      definitionWithSlackTargets([
        { type: 'dm', userId: 'user-2' },
        { type: 'channel', channelId: 'C-private' },
      ]),
      { id: 'admin-1', role: 'ADMIN' },
      'owner-1',
    )

    expect(result).toEqual({ ok: true })
  })
})
