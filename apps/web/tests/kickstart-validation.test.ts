import { describe, expect, it } from 'vitest'

import { parseKickstartApplyPayload } from '@/kickstart/validation'

function buildValidPayload() {
  return {
    companyName: 'Acme Labs',
    companyDescription: 'Analytics tools for operations teams',
    templateId: 'blank',
    agents: [
      { id: 'assistant' },
      { id: 'knowledge-curator' },
    ],
  }
}

describe('kickstart payload validation', () => {
  it.each([
    {
      name: 'extra top-level keys',
      payload: {
        ...buildValidPayload(),
        extra: 'value',
      },
      expectedMessage: 'payload has unsupported fields',
    },
    {
      name: 'unknown templateId',
      payload: {
        ...buildValidPayload(),
        templateId: 'unknown-template',
      },
      expectedMessage: 'unknown template id: unknown-template',
    },
    {
      name: 'missing required template agent',
      payload: {
        ...buildValidPayload(),
        agents: [{ id: 'assistant' }],
      },
      expectedMessage: 'required agent missing: knowledge-curator',
    },
    {
      name: 'companyName over max length',
      payload: {
        ...buildValidPayload(),
        companyName: 'a'.repeat(121),
      },
      expectedMessage: 'companyName exceeds 120 characters',
    },
    {
      name: 'companyDescription over max length',
      payload: {
        ...buildValidPayload(),
        companyDescription: 'a'.repeat(401),
      },
      expectedMessage: 'companyDescription exceeds 400 characters',
    },
  ])('rejects $name', ({ payload, expectedMessage }) => {
    const parsed = parseKickstartApplyPayload(payload)
    expect(parsed.ok).toBe(false)

    if (!parsed.ok) {
      expect(parsed.error).toBe('invalid_payload')
      expect(parsed.message).toContain(expectedMessage)
    }
  })

  it.each([
    { value: 0, valid: true },
    { value: 2, valid: true },
    { value: 2.01, valid: false, message: 'between 0 and 2' },
    { value: Number.NaN, valid: false, message: 'must be a number' },
    { value: -0.1, valid: false, message: 'between 0 and 2' },
  ])('validates agent temperature boundary: $value', ({ value, valid, message }) => {
    const parsed = parseKickstartApplyPayload({
      ...buildValidPayload(),
      agents: [
        { id: 'assistant', temperature: value },
        { id: 'knowledge-curator' },
      ],
    })

    expect(parsed.ok).toBe(valid)
    if (!valid && !parsed.ok) {
      expect(parsed.message).toContain(message)
    }
  })
})
