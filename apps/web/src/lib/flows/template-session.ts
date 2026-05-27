import type { FlowTemplate } from '@/lib/flows/import-export'
import { isRecord } from '@/lib/records'

const FLOW_TEMPLATE_SESSION_KEY = 'arche:flow-template'
const FLOW_TEMPLATE_SESSION_KEY_PREFIX = 'arche:flow-template:'

function createTemplateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseFlowTemplate(value: string | null): FlowTemplate | null {
  if (!value) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.format !== 'arche-flow-template/v1') return null
  return parsed as FlowTemplate
}

export function storeFlowTemplateDraft(template: FlowTemplate): void {
  if (typeof window === 'undefined') return

  const id = createTemplateSessionId()
  const key = `${FLOW_TEMPLATE_SESSION_KEY_PREFIX}${id}`
  window.sessionStorage.setItem(key, JSON.stringify(template))
  window.sessionStorage.setItem(FLOW_TEMPLATE_SESSION_KEY, id)
}

export function consumeFlowTemplateDraft(): FlowTemplate | null {
  if (typeof window === 'undefined') return null

  const pointer = window.sessionStorage.getItem(FLOW_TEMPLATE_SESSION_KEY)
  if (!pointer) return null

  const key = pointer.startsWith(FLOW_TEMPLATE_SESSION_KEY_PREFIX)
    ? pointer
    : `${FLOW_TEMPLATE_SESSION_KEY_PREFIX}${pointer}`
  const template = parseFlowTemplate(window.sessionStorage.getItem(key)) ?? parseFlowTemplate(pointer)

  window.sessionStorage.removeItem(FLOW_TEMPLATE_SESSION_KEY)
  window.sessionStorage.removeItem(key)
  return template
}
