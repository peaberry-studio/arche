import { describe, expect, it } from 'vitest'

import {
  buildAgentMentionSuggestions,
  findAgentMentionMatch,
  getAgentMentionAutocompletePosition,
  getEstimatedAgentMentionAutocompleteHeight,
} from '@/lib/workspace-agent-mentions'

const agents = [
  { id: 'assistant', displayName: 'Assistant', isPrimary: true },
  { id: 'content-writer', displayName: 'Content Writer', isPrimary: false },
  { id: 'data_analyst', displayName: 'Data Analyst', isPrimary: false },
  { id: 'qa-reviewer', displayName: 'QA Reviewer', isPrimary: false },
  { id: 'researcher', displayName: 'Researcher', isPrimary: false },
  { id: 'sales-assistant', displayName: 'Sales Assistant', isPrimary: false },
  { id: 'support-agent', displayName: 'Support Agent', isPrimary: false },
  { id: 'technical-editor', displayName: 'Technical Editor', isPrimary: false },
  { id: 'translator', displayName: 'Translator', isPrimary: false },
]

describe('workspace agent mention helpers', () => {
  it('detects mention matches at valid boundaries and expands through the token after the caret', () => {
    expect(findAgentMentionMatch('@assi hello', 3)).toEqual({ from: 0, to: 5, query: 'assi' })
    expect(findAgentMentionMatch('ask @researcher now', 8)).toEqual({ from: 4, to: 15, query: 'researcher' })
  })

  it('rejects mentions inside tokens, whitespace queries, repeated at-signs, and clamps carets', () => {
    expect(findAgentMentionMatch('email a@b.com', 8)).toBeNull()
    expect(findAgentMentionMatch('ask @researcher later', 19)).toBeNull()
    expect(findAgentMentionMatch('ask @@assistant', 6)).toBeNull()
    expect(findAgentMentionMatch('@assistant', 200)).toEqual({ from: 0, to: 10, query: 'assistant' })
  })

  it('orders suggestions by match strength, display name, and caps the result count', () => {
    expect(buildAgentMentionSuggestions(agents, 'assistant').map((agent) => agent.id)).toEqual([
      'assistant',
      'sales-assistant',
    ])
    expect(buildAgentMentionSuggestions(agents, 'data analyst').map((agent) => agent.id)).toEqual(['data_analyst'])
    expect(buildAgentMentionSuggestions(agents, '').map((agent) => agent.displayName)).toEqual([
      'Assistant',
      'Content Writer',
      'Data Analyst',
      'QA Reviewer',
      'Researcher',
      'Sales Assistant',
      'Support Agent',
      'Technical Editor',
    ])
  })

  it('estimates autocomplete height from item count', () => {
    expect(getEstimatedAgentMentionAutocompleteHeight(0)).toBe(10)
    expect(getEstimatedAgentMentionAutocompleteHeight(3)).toBe(100)
  })

  it('places the autocomplete below when there is room and clamps horizontal overflow', () => {
    expect(getAgentMentionAutocompletePosition({
      anchorLeft: 780,
      anchorTop: 200,
      popoverWidth: 320,
      popoverHeight: 130,
      viewportWidth: 900,
      viewportHeight: 700,
    })).toEqual({ left: 568, top: 208, placement: 'bottom' })
  })

  it('places the autocomplete above when below space is insufficient', () => {
    expect(getAgentMentionAutocompletePosition({
      anchorLeft: 4,
      anchorTop: 640,
      popoverWidth: 320,
      popoverHeight: 180,
      viewportWidth: 900,
      viewportHeight: 700,
    })).toEqual({ left: 12, top: 452, placement: 'top' })
  })

  it('chooses the larger constrained side when neither side fully fits', () => {
    expect(getAgentMentionAutocompletePosition({
      anchorLeft: 100,
      anchorTop: 90,
      popoverWidth: 320,
      popoverHeight: 220,
      viewportWidth: 900,
      viewportHeight: 260,
    })).toEqual({ left: 100, top: 28, placement: 'bottom' })
  })
})
