import { describe, expect, it } from 'vitest'

import { parseEvidence } from '@/lib/learning/repository'
import { isValidKbPath, parseProposalActionRequest, parseProposalRequest } from '@/lib/learning/validation'
import { LEARNING_TITLE_MAX_LENGTH } from '@/types/learning'

const validPayload = {
  title: 'Remember preference',
  type: 'preference',
  confidence: 0.8,
  evidence: { quote: 'Use concise answers', source: 'session' },
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  proposedContent: 'Use concise answers.',
  trigger: 'agent',
}

describe('parseProposalRequest', () => {
  it('accepts a valid proposal payload', () => {
    const result = parseProposalRequest(validPayload)

    expect(result).toMatchObject({ ok: true, value: validPayload })
  })

  it('rejects missing required fields', () => {
    expect(parseProposalRequest({ ...validPayload, title: '' })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, kbPath: '' })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, proposedContent: '' })).toEqual({ ok: false })
  })

  it('rejects invalid enum values', () => {
    expect(parseProposalRequest({ ...validPayload, type: 'unknown' })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, operation: 'delete' })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, trigger: 'timer' })).toEqual({ ok: false })
  })

  it('rejects confidence outside the accepted range', () => {
    expect(parseProposalRequest({ ...validPayload, confidence: -0.1 })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, confidence: 1.1 })).toEqual({ ok: false })
  })

  it('rejects invalid evidence', () => {
    expect(parseProposalRequest({ ...validPayload, evidence: { quote: 1 } })).toEqual({ ok: false })
    expect(parseProposalRequest({ ...validPayload, evidence: { source: 'x'.repeat(501) } })).toEqual({ ok: false })
  })

  it('rejects unsafe kb paths', () => {
    for (const kbPath of ['../secrets.md', 'notes/../../etc/passwd', '/absolute.md', 'notes//double.md', './relative.md', '.git/config', 'notes\\windows.md', 'trailing/']) {
      expect(parseProposalRequest({ ...validPayload, kbPath })).toEqual({ ok: false })
    }
  })

  it('accepts an optional reason and rejects an oversized one', () => {
    expect(parseProposalRequest({ ...validPayload, reason: 'Durable preference' })).toMatchObject({
      ok: true,
      value: { reason: 'Durable preference' },
    })
    expect(parseProposalRequest({ ...validPayload, reason: 'x'.repeat(LEARNING_TITLE_MAX_LENGTH + 1) })).toEqual({ ok: false })
  })
})

describe('isValidKbPath', () => {
  it('accepts plain relative paths', () => {
    expect(isValidKbPath('Preferences/Answers.md')).toBe(true)
    expect(isValidKbPath('notes.md')).toBe(true)
    expect(isValidKbPath('a/b/c.md')).toBe(true)
  })

  it('rejects traversal, absolute, and git paths', () => {
    expect(isValidKbPath('../escape.md')).toBe(false)
    expect(isValidKbPath('a/../b.md')).toBe(false)
    expect(isValidKbPath('/etc/passwd')).toBe(false)
    expect(isValidKbPath('.git/config')).toBe(false)
    expect(isValidKbPath('a\\b.md')).toBe(false)
    expect(isValidKbPath('a/\0b.md')).toBe(false)
    expect(isValidKbPath('')).toBe(false)
    expect(isValidKbPath('x'.repeat(501))).toBe(false)
  })
})

describe('parseProposalActionRequest', () => {
  it('accepts apply and reject actions', () => {
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'apply', content: 'edited' })).toEqual({
      ok: true,
      value: { action: 'apply', proposalId: 'proposal-1', content: 'edited' },
    })
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'reject' })).toEqual({
      ok: true,
      value: { action: 'reject', proposalId: 'proposal-1', content: undefined },
    })
  })

  it('rejects unknown actions and invalid proposal ids', () => {
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'delete' })).toEqual({ ok: false })
    expect(parseProposalActionRequest({ proposalId: '', action: 'apply' })).toEqual({ ok: false })
    expect(parseProposalActionRequest({ proposalId: 42, action: 'apply' })).toEqual({ ok: false })
    expect(parseProposalActionRequest(null)).toEqual({ ok: false })
  })

  it('rejects empty or oversized content', () => {
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'apply', content: '' })).toEqual({ ok: false })
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'apply', content: '   ' })).toEqual({ ok: false })
    expect(parseProposalActionRequest({ proposalId: 'proposal-1', action: 'apply', content: 'x'.repeat(200_001) })).toEqual({ ok: false })
  })

  it('accepts rebase and regenerate actions without content', () => {
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'rebase' })).toEqual({
      ok: true,
      value: { action: 'rebase', proposalId: 'change-1', content: undefined },
    })
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'regenerate' })).toEqual({
      ok: true,
      value: { action: 'regenerate', proposalId: 'change-1', content: undefined },
    })
  })

  it('requires string content for save_draft and accepts empty drafts', () => {
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'save_draft', content: '# Edited' })).toEqual({
      ok: true,
      value: { action: 'save_draft', proposalId: 'change-1', content: '# Edited' },
    })
    // An empty draft is allowed — unlike apply, save_draft does not require non-whitespace content.
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'save_draft', content: '' })).toEqual({
      ok: true,
      value: { action: 'save_draft', proposalId: 'change-1', content: '' },
    })
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'save_draft' })).toEqual({ ok: false })
    expect(parseProposalActionRequest({ proposalId: 'change-1', action: 'save_draft', content: 'x'.repeat(200_001) })).toEqual({ ok: false })
  })
})

describe('parseEvidence', () => {
  it('parses SQLite string evidence values', () => {
    expect(parseEvidence(JSON.stringify({ quote: 'Use concise answers', source: 'session' }))).toEqual({
      quote: 'Use concise answers',
      source: 'session',
    })
  })

  it('returns empty evidence for invalid string values', () => {
    expect(parseEvidence('not-json')).toEqual({})
  })
})
