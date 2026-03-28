import test from 'node:test'
import assert from 'node:assert/strict'

import { draft } from '../tools/email.js'

function parseToolOutput(output) {
  return JSON.parse(output)
}

test('email_draft tool returns normalized structured output', async () => {
  const output = parseToolOutput(await draft.execute({
    subject: '  Follow-up on proposal  ',
    body: 'Hola Ana,\r\n\r\nGracias por tu tiempo.',
    to: ['ana@example.com', 'ana@example.com'],
    cc: 'ops@example.com, finance@example.com',
  }))

  assert.equal(output.ok, true)
  assert.equal(output.format, 'email-draft')
  assert.equal(output.subject, 'Follow-up on proposal')
  assert.equal(output.body, 'Hola Ana,\n\nGracias por tu tiempo.')
  assert.deepEqual(output.to, ['ana@example.com'])
  assert.deepEqual(output.cc, ['ops@example.com', 'finance@example.com'])
  assert.deepEqual(output.bcc, [])
  assert.equal(
    output.copyText,
    'To: ana@example.com\nCc: ops@example.com, finance@example.com\nSubject: Follow-up on proposal\n\nHola Ana,\n\nGracias por tu tiempo.'
  )
})

test('email_draft tool rejects empty subject/body after trimming', async () => {
  const output = parseToolOutput(await draft.execute({
    subject: '   ',
    body: '   ',
  }))

  assert.equal(output.ok, false)
  assert.equal(output.error, 'invalid_email_draft')
})
