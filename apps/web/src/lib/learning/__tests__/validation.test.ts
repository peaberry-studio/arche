import { describe, expect, it } from 'vitest'

import { parseProposalRequest } from '@/lib/learning/validation'

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
})
