import { describe, expect, it } from 'vitest'

import { formatSlackMessages } from '@/lib/slack/formatter'

describe('formatSlackMessages', () => {
  it('converts common Markdown constructs to Slack mrkdwn', () => {
    const [message] = formatSlackMessages([
      '# Summary',
      '',
      '**Bold**, *italic*, and ~~removed~~.',
      '[Arche](https://arche.example/docs?a=1&b=2)',
      '- first',
      '> quoted',
    ].join('\n'))

    expect(message).toBe([
      '*Summary*',
      '',
      '*Bold*, _italic_, and ~removed~.',
      '<https://arche.example/docs?a=1&amp;b=2|Arche>',
      '• first',
      '> quoted',
    ].join('\n'))
  })

  it('preserves code content without formatting or Slack escaping', () => {
    const [message] = formatSlackMessages('Use `**x** <tag> & value` here.\n\n```ts\nconst x = "<tag> & **raw**"\n```')

    expect(message).toBe('Use `**x** <tag> & value` here.\n\n```\nconst x = "<tag> & **raw**"\n```')
  })

  it('keeps Slack controls inert when a code span contains a backtick', () => {
    expect(formatSlackMessages('``code`<@U123>``', ['<@U123>'])[0]).toBe('`code`&lt;@U123&gt;`')
  })

  it('escapes Slack controls and only preserves authorized user mentions', () => {
    const [message] = formatSlackMessages(
      '<script> & <!channel> <@U123> <@U999> @channel @here',
      ['<@U123>'],
    )

    expect(message).toBe('&lt;script&gt; &amp; &lt;!channel&gt; <@U123> &lt;@U999&gt; @channel @here')
  })

  it('requires an exact authorized mention token', () => {
    expect(formatSlackMessages('Hello <@u123>', ['<@U123>'])[0]).toBe('Hello &lt;@u123&gt;')
  })

  it('normalizes line endings and removes control characters while preserving Unicode', () => {
    expect(formatSlackMessages('Hello\r\nПривет\u0007 <tag> &')[0]).toBe(
      'Hello\nПривет &lt;tag&gt; &amp;',
    )
  })

  it('leaves unsafe and malformed links inactive without throwing', () => {
    expect(formatSlackMessages('[click](javascript:alert) <broken')[0]).toBe(
      '[click](javascript:alert) &lt;broken',
    )
  })

  it('encodes Slack control characters inside otherwise safe links', () => {
    expect(formatSlackMessages('[click](https://arche.example/<@U999>)', ['<@U999>'])[0]).toBe(
      '<https://arche.example/%3C@U999%3E|click>',
    )
  })

  it('preserves Unicode that matches the internal placeholder format', () => {
    expect(formatSlackMessages('\uE0000\uE001 **bold**')[0]).toBe('\uE0000\uE001 *bold*')
  })

  it('restores code spans nested inside link labels', () => {
    expect(formatSlackMessages('[`code`](https://example.com)')[0]).toBe(
      '<https://example.com|`code`>',
    )
  })

  it('splits long Unicode responses into messages of at most 3,500 visible characters', () => {
    const messages = formatSlackMessages(`Intro\n\n${'🙂'.repeat(7_001)}`)

    expect(messages.length).toBeGreaterThan(2)
    expect(messages.every((message) => Array.from(message).length <= 3_500)).toBe(true)
    expect(messages.join('').replace('Intro', '')).toContain('🙂'.repeat(7_001))
  })

  it('closes and reopens fenced code blocks when splitting them', () => {
    const messages = formatSlackMessages(`\`\`\`\n${'x'.repeat(7_000)}\n\`\`\``)

    expect(messages).toHaveLength(3)
    expect(messages.every((message) => message.startsWith('```\n') && message.endsWith('\n```'))).toBe(true)
  })
})
