import { describe, expect, it } from 'vitest'

import { buildSlackDmPrompt } from '../dm-prompt'

describe('buildSlackDmPrompt', () => {
  it('asks for standard Markdown and explains Slack delivery normalization', () => {
    const prompt = buildSlackDmPrompt({ text: 'Summarize this' })

    expect(prompt).toContain('Use standard Markdown; the delivery layer normalizes it for Slack.')
  })
})
