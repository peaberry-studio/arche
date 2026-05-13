import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SlackChatClient } from '@/lib/slack/socket-types'

const mocks = vi.hoisted(() => ({
  loadSlackAgentOptions: vi.fn(),
  slackService: {
    findIntegration: vi.fn(),
  },
}))

vi.mock('@/lib/services', () => ({ slackService: mocks.slackService }))
vi.mock('@/lib/slack/agents', () => ({ loadSlackAgentOptions: mocks.loadSlackAgentOptions }))

import {
  buildSlackDmDecisionBlocks,
  buildSlackDmSessionTitle,
  buildSlackSessionTitle,
  buildSlackThreadKey,
  extractSlackResponseTs,
  finalizeSlackDmReply,
  finalizeSlackReply,
  getEventId,
  getSlackActionTarget,
  getSlackActionValue,
  isSlackDmCommand,
  isSlackDmMessage,
  loadSlackUserProfile,
  mapSlackFailureToMessage,
  mapSlackUserResolutionError,
  normalizeSlackCommandBody,
  normalizeSlackMessageEvent,
  postSlackDmMessage,
  postSlackDmPlaceholder,
  postSlackPlaceholder,
  resolveConfiguredSlackAgentId,
  resolveSlackTeamId,
  resolveTargetAgentId,
  shouldIgnoreSlackMessage,
  stripBotMention,
  updateSlackActionMessage,
} from '../socket-utils'

function makeClient(): SlackChatClient {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '111.222' }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
    conversations: {
      history: vi.fn().mockResolvedValue({ messages: [] }),
      replies: vi.fn().mockResolvedValue({ messages: [] }),
    },
    users: {
      info: vi.fn().mockResolvedValue({ user: null }),
    },
  }
}

describe('slack socket utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds Slack titles, keys, and blocks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'))

    expect(buildSlackSessionTitle('C1', '100.1')).toBe('Slack | C1 | 100.1')
    expect(buildSlackThreadKey('C1', '100.1')).toBe('C1:100.1')
    expect(buildSlackDmSessionTitle({ displayName: 'Alice', email: 'alice@test.com' })).toBe(
      'Slack DM | Alice | 2026-04-25T12:00:00.000Z',
    )
    expect(buildSlackDmSessionTitle({ displayName: null, email: null })).toBe(
      'Slack DM | unknown Slack user | 2026-04-25T12:00:00.000Z',
    )
    expect(buildSlackDmDecisionBlocks('decision-1')).toEqual([
      expect.objectContaining({ type: 'section' }),
      expect.objectContaining({ type: 'actions' }),
    ])

    vi.useRealTimers()
  })

  it('extracts event, team, action, target, and response identifiers', async () => {
    mocks.slackService.findIntegration.mockResolvedValue({ slackTeamId: 'T-fallback' })

    expect(getEventId(null)).toBeNull()
    expect(getEventId({ event_id: 'evt-1' })).toBe('evt-1')
    await expect(resolveSlackTeamId({ team_id: 'T1' })).resolves.toBe('T1')
    await expect(resolveSlackTeamId({ team: { id: 'T2' } })).resolves.toBe('T2')
    await expect(resolveSlackTeamId({ authorizations: [null, { team_id: 'T3' }] })).resolves.toBe('T3')
    await expect(resolveSlackTeamId({})).resolves.toBe('T-fallback')
    expect(getSlackActionValue({ actions: [{ value: 'decision-1' }] })).toBe('decision-1')
    expect(getSlackActionValue({ actions: [{ value: '' }] })).toBeNull()
    expect(getSlackActionTarget({ channel: { id: 'C1' }, message: { ts: '100.1' } })).toEqual({
      channelId: 'C1',
      messageTs: '100.1',
    })
    expect(getSlackActionTarget({ channel: {}, message: {} })).toBeNull()
    expect(extractSlackResponseTs({ ts: '111.222' })).toBe('111.222')
    expect(extractSlackResponseTs({ ts: 123 })).toBeNull()
  })

  it('maps Slack messages, commands, and error states', () => {
    expect(mapSlackFailureToMessage('autopilot_run_timeout')).toContain('too long')
    expect(mapSlackFailureToMessage('autopilot_no_assistant_message')).toContain('could not produce')
    expect(mapSlackFailureToMessage('provider_auth_missing')).toContain('provider credentials')
    expect(mapSlackFailureToMessage('session_busy')).toContain('already working')
    expect(mapSlackFailureToMessage('other')).toContain('preparing')
    expect(mapSlackUserResolutionError('slack_email_missing')).toContain('Slack email')
    expect(mapSlackUserResolutionError('slack_email_not_found')).toContain('email matches')
    expect(mapSlackUserResolutionError('other')).toContain('linked')
    expect(normalizeSlackMessageEvent(null)).toBeNull()
    expect(normalizeSlackMessageEvent({ bot_id: 'B1', channel: 'D1', channel_type: 'im', text: 'hi' })).toEqual({
      bot_id: 'B1',
      channel: 'D1',
      channel_type: 'im',
      subtype: undefined,
      text: 'hi',
      thread_ts: undefined,
      ts: undefined,
      user: undefined,
    })
    expect(normalizeSlackCommandBody(null)).toBeNull()
    expect(normalizeSlackCommandBody({ channel_id: 'D1', channel_name: 'directmessage', text: 'hi' })).toEqual({
      channel_id: 'D1',
      channel_name: 'directmessage',
      team_id: undefined,
      text: 'hi',
      user_id: undefined,
    })
    expect(isSlackDmMessage({ channel_type: 'im' })).toBe(true)
    expect(isSlackDmMessage({ channel: 'D1' })).toBe(true)
    expect(isSlackDmCommand({ channel_name: 'directmessage' })).toBe(true)
    expect(isSlackDmCommand({ channel_id: 'D1' })).toBe(true)
    expect(shouldIgnoreSlackMessage({ subtype: 'message_changed' }, null)).toBe(true)
    expect(shouldIgnoreSlackMessage({ bot_id: 'B1' }, null)).toBe(true)
    expect(shouldIgnoreSlackMessage({ user: 'U-bot' }, 'U-bot')).toBe(true)
    expect(shouldIgnoreSlackMessage({ user: 'U-human' }, 'U-bot')).toBe(false)
    expect(stripBotMention(' <@U-bot> hello ', 'U-bot')).toBe('hello')
    expect(stripBotMention(' hello ', null)).toBe('hello')
  })

  it('loads Slack user profiles defensively', async () => {
    const client = makeClient()
    vi.mocked(client.users.info).mockResolvedValueOnce({
      user: {
        name: 'alice-user',
        profile: {
          display_name: ' Alice ',
          email: 'alice@test.com',
        },
      },
    })
    vi.mocked(client.users.info).mockResolvedValueOnce({ user: null })
    vi.mocked(client.users.info).mockRejectedValueOnce(new Error('slack down'))

    await expect(loadSlackUserProfile(client, 'U1')).resolves.toEqual({
      displayName: 'Alice',
      email: 'alice@test.com',
    })
    await expect(loadSlackUserProfile(client, 'U2')).resolves.toEqual({ displayName: null, email: null })
    await expect(loadSlackUserProfile(client, 'U3')).resolves.toEqual({ displayName: null, email: null })
  })

  it('posts and finalizes Slack channel replies', async () => {
    const client = makeClient()

    await expect(postSlackPlaceholder(client, 'C1', '100.1')).resolves.toBe('111.222')
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: 'Thinking...',
      thread_ts: '100.1',
    })

    await finalizeSlackReply(client, 'C1', '100.1', '111.222', 'done')
    expect(client.chat.update).toHaveBeenCalledWith({ channel: 'C1', text: 'done', ts: '111.222' })

    await finalizeSlackReply(client, 'C1', '100.1', null, 'fallback')
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      text: 'fallback',
      thread_ts: '100.1',
    })

    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(new Error('slack down'))
    await expect(postSlackPlaceholder(client, 'C1', '100.1')).resolves.toBeNull()
  })

  it('posts and finalizes Slack DM replies', async () => {
    const client = makeClient()

    await expect(postSlackDmPlaceholder(client, 'D1')).resolves.toBe('111.222')
    expect(client.chat.postMessage).toHaveBeenCalledWith({ channel: 'D1', text: 'Thinking...' })

    await finalizeSlackDmReply(client, 'D1', '111.222', 'done')
    expect(client.chat.update).toHaveBeenCalledWith({ channel: 'D1', text: 'done', ts: '111.222' })

    await finalizeSlackDmReply(client, 'D1', null, 'fallback')
    expect(client.chat.postMessage).toHaveBeenCalledWith({ channel: 'D1', text: 'fallback' })
    await postSlackDmMessage(client, 'D1', 'direct')
    expect(client.chat.postMessage).toHaveBeenCalledWith({ channel: 'D1', text: 'direct' })

    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(new Error('slack down'))
    await expect(postSlackDmPlaceholder(client, 'D1')).resolves.toBeNull()
  })

  it('updates Slack action messages only when a target exists', async () => {
    const client = makeClient()

    await updateSlackActionMessage(client, null, 'ignored')
    expect(client.chat.update).not.toHaveBeenCalled()

    await updateSlackActionMessage(client, { channelId: 'C1', messageTs: '100.1' }, 'updated')
    expect(client.chat.update).toHaveBeenCalledWith({
      blocks: [],
      channel: 'C1',
      text: 'updated',
      ts: '100.1',
    })
  })

  it('resolves Slack target agent ids from configured options', async () => {
    mocks.loadSlackAgentOptions
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, agents: [{ id: 'agent-1' }], primaryAgentId: 'agent-primary' })
      .mockResolvedValueOnce({ ok: true, agents: [{ id: 'agent-1' }], primaryAgentId: 'agent-primary' })
      .mockResolvedValueOnce({ ok: true, agents: [], primaryAgentId: 'agent-primary' })
    mocks.slackService.findIntegration.mockResolvedValue({ defaultAgentId: 'agent-missing' })

    await expect(resolveTargetAgentId('agent-default')).resolves.toBe('agent-default')
    await expect(resolveTargetAgentId('agent-1')).resolves.toBe('agent-1')
    await expect(resolveTargetAgentId('agent-missing')).resolves.toBe('agent-primary')
    await expect(resolveConfiguredSlackAgentId()).resolves.toBe('agent-primary')
  })
})
