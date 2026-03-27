import { z } from 'zod'

const MAX_RECIPIENTS_PER_LIST = 50

function toToolOutput(value) {
  return JSON.stringify(value, null, 2)
}

function normalizeMultilineText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function normalizeRecipientList(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  const recipients = []
  const seen = new Set()

  for (const rawValue of rawValues) {
    const recipient = String(rawValue).trim()
    if (!recipient) continue

    const dedupeKey = recipient.toLowerCase()
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    recipients.push(recipient)

    if (recipients.length >= MAX_RECIPIENTS_PER_LIST) {
      break
    }
  }

  return recipients
}

function buildCopyText({ to, cc, bcc, subject, body }) {
  const lines = []

  if (to.length > 0) lines.push(`To: ${to.join(', ')}`)
  if (cc.length > 0) lines.push(`Cc: ${cc.join(', ')}`)
  if (bcc.length > 0) lines.push(`Bcc: ${bcc.join(', ')}`)

  lines.push(`Subject: ${subject}`, '', body)
  return lines.join('\n')
}

const recipientListSchema = z.union([z.array(z.string()), z.string()]).optional()

export const draft = {
  description: 'Create a structured email draft so the UI can render and copy only the email body.',
  args: {
    subject: z.string().min(1).describe('Email subject line.'),
    body: z.string().min(1).describe('Email body content.'),
    to: recipientListSchema.describe('Optional recipients. Accepts a list or a comma-separated string.'),
    cc: recipientListSchema.describe('Optional CC recipients. Accepts a list or a comma-separated string.'),
    bcc: recipientListSchema.describe('Optional BCC recipients. Accepts a list or a comma-separated string.'),
  },
  async execute(args) {
    const subject = String(args.subject || '').trim()
    const body = normalizeMultilineText(args.body || '')

    if (!subject || !body) {
      return toToolOutput({
        ok: false,
        error: 'invalid_email_draft',
      })
    }

    const to = normalizeRecipientList(args.to)
    const cc = normalizeRecipientList(args.cc)
    const bcc = normalizeRecipientList(args.bcc)
    const copyText = buildCopyText({ to, cc, bcc, subject, body })

    return toToolOutput({
      ok: true,
      format: 'email-draft',
      subject,
      body,
      to,
      cc,
      bcc,
      copyText,
    })
  },
}
