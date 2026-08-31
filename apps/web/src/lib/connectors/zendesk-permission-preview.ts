import type { ZendeskActionName } from '@/lib/connectors/zendesk-types'

export const ZENDESK_CONNECTOR_DISPLAY_NAME = 'Zendesk'

const ZENDESK_ACTION_SUFFIXES: ZendeskActionName[] = [
  'search_tickets',
  'get_ticket',
  'list_ticket_comments',
  'create_ticket_public',
  'create_ticket_internal',
  'update_ticket_fields',
  'update_ticket_with_public_comment',
  'update_ticket_with_internal_note',
]

const ACTION_LABELS: Record<ZendeskActionName, string> = {
  search_tickets: 'Search tickets',
  get_ticket: 'Read ticket details',
  list_ticket_comments: 'List ticket comments',
  create_ticket_public: 'Create ticket with a public comment',
  create_ticket_internal: 'Create ticket with an internal note',
  update_ticket_fields: 'Update ticket fields',
  update_ticket_with_public_comment: 'Update ticket with a public comment',
  update_ticket_with_internal_note: 'Update ticket with an internal note',
}

export type ZendeskPreviewField = {
  label: string
  value: string
}

export type ZendeskPermissionPreview = {
  action: ZendeskActionName
  actionLabel: string
  connectorName: string
  fields: ZendeskPreviewField[]
  visibility: 'public' | 'internal' | null
}

export function matchZendeskActionName(text: string | undefined): ZendeskActionName | null {
  if (!text) return null

  for (const action of ZENDESK_ACTION_SUFFIXES) {
    if (text.endsWith(action)) return action
  }

  return null
}

function toPreviewString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function addField(
  fields: ZendeskPreviewField[],
  input: Record<string, unknown>,
  key: string,
  label: string
): void {
  const value = toPreviewString(input[key])
  if (value !== null) {
    fields.push({ label, value })
  }
}

function addTagsField(fields: ZendeskPreviewField[], input: Record<string, unknown>): void {
  const tags = input.tags
  if (!Array.isArray(tags)) return

  const values = tags
    .map((tag) => toPreviewString(tag))
    .filter((tag): tag is string => tag !== null)
  if (values.length > 0) {
    fields.push({ label: 'Tags', value: values.join(', ') })
  }
}

// Builds the approval preview from the atomic tool name and the model-produced
// input stored on the correlated tool part. Only whitelisted schema fields are
// rendered; unknown metadata, connector configuration, and credentials are
// never included.
export function buildZendeskPermissionPreview(
  toolName: string,
  input: Record<string, unknown>
): ZendeskPermissionPreview | null {
  const action = matchZendeskActionName(toolName)
  if (!action) return null

  const fields: ZendeskPreviewField[] = []
  let visibility: 'public' | 'internal' | null = null

  switch (action) {
    case 'search_tickets':
      addField(fields, input, 'query', 'Query')
      addField(fields, input, 'page', 'Page')
      addField(fields, input, 'perPage', 'Per page')
      break
    case 'get_ticket':
    case 'list_ticket_comments':
      addField(fields, input, 'ticketId', 'Ticket ID')
      break
    case 'create_ticket_public':
    case 'create_ticket_internal':
      visibility = action === 'create_ticket_public' ? 'public' : 'internal'
      addField(fields, input, 'subject', 'Subject')
      addField(fields, input, 'comment', 'Comment')
      addField(fields, input, 'priority', 'Priority')
      addField(fields, input, 'status', 'Status')
      addField(fields, input, 'type', 'Type')
      addTagsField(fields, input)
      break
    case 'update_ticket_fields':
      addField(fields, input, 'ticketId', 'Ticket ID')
      addField(fields, input, 'subject', 'Subject')
      addField(fields, input, 'priority', 'Priority')
      addField(fields, input, 'status', 'Status')
      addField(fields, input, 'type', 'Type')
      addField(fields, input, 'assigneeId', 'Assignee ID')
      break
    case 'update_ticket_with_public_comment':
    case 'update_ticket_with_internal_note':
      visibility = action === 'update_ticket_with_public_comment' ? 'public' : 'internal'
      addField(fields, input, 'ticketId', 'Ticket ID')
      addField(fields, input, 'subject', 'Subject')
      addField(fields, input, 'comment', 'Comment')
      addField(fields, input, 'priority', 'Priority')
      addField(fields, input, 'status', 'Status')
      addField(fields, input, 'type', 'Type')
      addField(fields, input, 'assigneeId', 'Assignee ID')
      break
  }

  return {
    action,
    actionLabel: ACTION_LABELS[action],
    connectorName: ZENDESK_CONNECTOR_DISPLAY_NAME,
    fields,
    visibility,
  }
}
