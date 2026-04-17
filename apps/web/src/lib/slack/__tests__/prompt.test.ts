import { describe, expect, it } from 'vitest'

import { buildSlackPrompt } from '../prompt'

describe('buildSlackPrompt', () => {
  it('tells the model not to narrate tool use or status updates', () => {
    const prompt = buildSlackPrompt({
      contextText: 'Conversation history',
      mentionTokens: ['<@U123>'],
    })

    expect(prompt).toContain('Do not narrate tool use, hidden reasoning, or status updates.')
  })
})
