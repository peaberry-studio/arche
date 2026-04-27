import { describe, expect, it, vi } from 'vitest'

import { buildSlackContext } from '../context'

function makeClient(overrides: {
  history?: (args: unknown) => Promise<unknown>
  replies?: (args: unknown) => Promise<unknown>
  usersInfo?: (args: unknown) => Promise<unknown>
} = {}) {
  return {
    conversations: {
      history: vi.fn(overrides.history ?? (async () => ({ messages: [] }))),
      replies: vi.fn(overrides.replies ?? (async () => ({ messages: [] }))),
    },
    users: {
      info: vi.fn(overrides.usersInfo ?? (async () => ({ user: {} }))),
    },
  }
}

function makeEvent(overrides: {
  channel?: string
  text?: string
  threadTs?: string | null
  ts?: string
  user?: string | null
} = {}) {
  return {
    channel: overrides.channel ?? 'C001',
    text: overrides.text ?? 'hello world',
    threadTs: 'threadTs' in overrides ? (overrides.threadTs ?? null) : null,
    ts: overrides.ts ?? '1700000000.000001',
    user: 'user' in overrides ? (overrides.user ?? null) : 'U100',
  }
}

describe('buildSlackContext', () => {
  describe('channel mode (threadTs is null)', () => {
    it('calls conversations.history with channel, ts, inclusive, and limit', async () => {
      const client = makeClient()
      const event = makeEvent({ channel: 'C999', ts: '1700000001.000000' })

      await buildSlackContext(client, event)

      expect(client.conversations.history).toHaveBeenCalledWith({
        channel: 'C999',
        inclusive: true,
        latest: '1700000001.000000',
        limit: 8,
      })
      expect(client.conversations.replies).not.toHaveBeenCalled()
    })

    it('labels the history section as "Recent channel history"', async () => {
      const client = makeClient()
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Recent channel history:')
      expect(contextText).not.toContain('Recent thread history:')
    })

    it('shows "new thread" for the Thread line', async () => {
      const client = makeClient()
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Thread: new thread')
    })
  })

  describe('thread mode (threadTs is set)', () => {
    it('calls conversations.replies with channel, threadTs, and limit', async () => {
      const client = makeClient()
      const event = makeEvent({ threadTs: '1700000000.000000' })

      await buildSlackContext(client, event)

      expect(client.conversations.replies).toHaveBeenCalledWith({
        channel: 'C001',
        limit: 12,
        ts: '1700000000.000000',
      })
      expect(client.conversations.history).not.toHaveBeenCalled()
    })

    it('labels the history section as "Recent thread history"', async () => {
      const client = makeClient()
      const event = makeEvent({ threadTs: '1700000000.000000' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Recent thread history:')
      expect(contextText).not.toContain('Recent channel history:')
    })

    it('shows the threadTs value for the Thread line', async () => {
      const client = makeClient()
      const event = makeEvent({ threadTs: '1700000099.123456' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Thread: 1700000099.123456')
    })
  })

  describe('user resolution', () => {
    it('resolves each unique user via users.info', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '1', user: 'U200', text: 'hi' },
            { ts: '2', user: 'U300', text: 'hey' },
            { ts: '3', user: 'U200', text: 'again' },
          ],
        }),
        usersInfo: async ({ user }: { user: string }) => ({
          user: { profile: { display_name: `name-${user}` } },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      await buildSlackContext(client, event)

      // U100 (event user), U200, U300 — each resolved once
      expect(client.users.info).toHaveBeenCalledTimes(3)
      expect(client.users.info).toHaveBeenCalledWith({ user: 'U100' })
      expect(client.users.info).toHaveBeenCalledWith({ user: 'U200' })
      expect(client.users.info).toHaveBeenCalledWith({ user: 'U300' })
    })

    it('uses display_name first', async () => {
      const client = makeClient({
        usersInfo: async () => ({
          user: {
            name: 'fallback',
            profile: { display_name: 'Display', real_name: 'Real' },
          },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Display (<@U100>)')
    })

    it('falls back to real_name when display_name is empty', async () => {
      const client = makeClient({
        usersInfo: async () => ({
          user: {
            name: 'fallback',
            profile: { display_name: '', real_name: 'Real Name' },
          },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Real Name (<@U100>)')
    })

    it('falls back to user.name when profile names are empty', async () => {
      const client = makeClient({
        usersInfo: async () => ({
          user: {
            name: 'username',
            profile: { display_name: '', real_name: '' },
          },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('username (<@U100>)')
    })

    it('falls back to raw mention when no names are available', async () => {
      const client = makeClient({
        usersInfo: async () => ({
          user: { profile: {} },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('<@U100>')
    })

    it('falls back to raw mention when users.info returns no user object', async () => {
      const client = makeClient({
        usersInfo: async () => ({}),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      // The "Known Slack users" section should show the raw mention
      expect(contextText).toContain('- <@U100>')
    })
  })

  describe('message formatting', () => {
    it('formats user messages as "label: text"', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [{ ts: '1', user: 'U200', text: 'hello from user' }],
        }),
        usersInfo: async ({ user }: { user: string }) => ({
          user: { profile: { display_name: user === 'U200' ? 'Alice' : '' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- Alice (<@U200>): hello from user')
    })

    it('formats bot messages as "Bot(id): text"', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [{ ts: '1', bot_id: 'B001', text: 'bot says hi', user: undefined }],
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- Bot(B001): bot says hi')
    })

    it('formats messages with no user or bot as "Unknown: text"', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [{ ts: '1', text: 'mystery message' }],
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- Unknown: mystery message')
    })

    it('sorts messages by timestamp', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '3', user: 'U200', text: 'third' },
            { ts: '1', user: 'U200', text: 'first' },
            { ts: '2', user: 'U200', text: 'second' },
          ],
        }),
        usersInfo: async () => ({
          user: { profile: { display_name: 'A' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      const lines = contextText.split('\n')
      const firstIdx = lines.findIndex((l) => l.includes('first'))
      const secondIdx = lines.findIndex((l) => l.includes('second'))
      const thirdIdx = lines.findIndex((l) => l.includes('third'))

      expect(firstIdx).toBeLessThan(secondIdx)
      expect(secondIdx).toBeLessThan(thirdIdx)
    })
  })

  describe('empty/missing text', () => {
    it('shows [no text] for history messages with empty text', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [{ ts: '1', user: 'U200', text: '' }],
        }),
        usersInfo: async () => ({
          user: { profile: { display_name: 'A' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('[no text]')
    })

    it('shows [no text] for history messages with missing text', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [{ ts: '1', user: 'U200' }],
        }),
        usersInfo: async () => ({
          user: { profile: { display_name: 'A' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('[no text]')
    })

    it('shows [no text] for the event message when text is whitespace', async () => {
      const client = makeClient()
      const event = makeEvent({ text: '   ' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('[no text]')
    })
  })

  describe('API errors', () => {
    it('returns empty history when conversations.history throws', async () => {
      const client = makeClient({
        history: async () => { throw new Error('Slack API error') },
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- no recent Slack history available')
    })

    it('returns empty history when conversations.replies throws', async () => {
      const client = makeClient({
        replies: async () => { throw new Error('Slack API error') },
      })
      const event = makeEvent({ threadTs: '1700000000.000000' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- no recent Slack history available')
    })

    it('uses fallback label when users.info throws', async () => {
      const client = makeClient({
        usersInfo: async () => { throw new Error('user not found') },
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      // Fallback label is the raw mention without the "name (mention)" format
      expect(contextText).toContain('<@U100>')
      // Should still complete without error
      expect(contextText).toContain('Newest Slack message:')
    })
  })

  describe('mentionTokens', () => {
    it('returns sorted <@userId> tokens for all referenced users', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '1', user: 'U300', text: 'hi' },
            { ts: '2', user: 'U200', text: 'hey' },
          ],
        }),
        usersInfo: async () => ({ user: { profile: {} } }),
      })
      const event = makeEvent({ user: 'U100' })

      const { mentionTokens } = await buildSlackContext(client, event)

      expect(mentionTokens).toEqual(['<@U100>', '<@U200>', '<@U300>'])
    })

    it('deduplicates users that appear in both history and event', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '1', user: 'U100', text: 'hi' },
            { ts: '2', user: 'U100', text: 'again' },
          ],
        }),
        usersInfo: async () => ({ user: { profile: {} } }),
      })
      const event = makeEvent({ user: 'U100' })

      const { mentionTokens } = await buildSlackContext(client, event)

      expect(mentionTokens).toEqual(['<@U100>'])
    })

    it('excludes null users from mention tokens', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '1', bot_id: 'B001', text: 'bot msg' },
          ],
        }),
        usersInfo: async () => ({ user: { profile: {} } }),
      })
      const event = makeEvent({ user: 'U100' })

      const { mentionTokens } = await buildSlackContext(client, event)

      expect(mentionTokens).toEqual(['<@U100>'])
    })
  })

  describe('no messages', () => {
    it('includes "no recent Slack history available" when history is empty', async () => {
      const client = makeClient({
        history: async () => ({ messages: [] }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- no recent Slack history available')
    })

    it('includes "no recent Slack history available" when messages key is missing', async () => {
      const client = makeClient({
        history: async () => ({}),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- no recent Slack history available')
    })
  })

  describe('event with no user', () => {
    it('shows "Unknown user" for the newest message when event.user is null', async () => {
      const client = makeClient()
      const event = makeEvent({ user: null })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('Unknown user: hello world')
    })

    it('shows "none provided" in Known Slack users when no users are present', async () => {
      const client = makeClient()
      const event = makeEvent({ user: null })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- none provided')
    })
  })

  describe('Known Slack users section', () => {
    it('lists users with resolved labels', async () => {
      const client = makeClient({
        usersInfo: async ({ user }: { user: string }) => ({
          user: { profile: { display_name: `name-${user}` } },
        }),
      })
      const event = makeEvent({ user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('- <@U100> = name-U100 (<@U100>)')
    })
  })

  describe('full output structure', () => {
    it('produces the expected output shape with all sections', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { ts: '1', user: 'U200', text: 'context msg' },
          ],
        }),
        usersInfo: async ({ user }: { user: string }) => ({
          user: { profile: { display_name: user === 'U200' ? 'Bob' : 'Alice' } },
        }),
      })
      const event = makeEvent({ channel: 'C001', text: 'new message', user: 'U100' })

      const { contextText } = await buildSlackContext(client, event)

      const lines = contextText.split('\n')
      expect(lines[0]).toBe('Channel: C001')
      expect(lines[1]).toBe('Thread: new thread')
      expect(lines[2]).toBe('Known Slack users:')
      expect(lines).toContain('Recent channel history:')
      expect(lines).toContain('Newest Slack message:')

      // History message and event message are both present
      expect(contextText).toContain('Bob (<@U200>): context msg')
      expect(contextText).toContain('Alice (<@U100>): new message')
    })

    it('skips messages without a ts field', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [
            { user: 'U200', text: 'no ts' },
            { ts: '1', user: 'U200', text: 'has ts' },
          ],
        }),
        usersInfo: async () => ({
          user: { profile: { display_name: 'A' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).not.toContain('no ts')
      expect(contextText).toContain('has ts')
    })

    it('skips null/non-object entries in messages array', async () => {
      const client = makeClient({
        history: async () => ({
          messages: [null, 42, 'bad', { ts: '1', user: 'U200', text: 'valid' }],
        }),
        usersInfo: async () => ({
          user: { profile: { display_name: 'A' } },
        }),
      })
      const event = makeEvent()

      const { contextText } = await buildSlackContext(client, event)

      expect(contextText).toContain('valid')
    })
  })
})
