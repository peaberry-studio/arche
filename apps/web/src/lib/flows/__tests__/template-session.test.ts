/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import { FLOW_TEMPLATE_FORMAT, type FlowTemplate } from '@/lib/flows/import-export'
import { consumeFlowTemplateDraft, storeFlowTemplateDraft } from '@/lib/flows/template-session'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

function createTemplate(): FlowTemplate {
  return {
    cronExpression: null,
    definition: createDefaultFlowDefinition(),
    description: 'Imported template',
    enabled: false,
    format: FLOW_TEMPLATE_FORMAT,
    name: 'Imported flow',
    timezone: 'UTC',
  }
}

describe('flow template session storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('stores and consumes imported template drafts once', () => {
    const template = createTemplate()

    storeFlowTemplateDraft(template)

    expect(consumeFlowTemplateDraft()).toEqual(template)
    expect(consumeFlowTemplateDraft()).toBeNull()
  })

  it('rejects invalid session drafts and removes the pointer', () => {
    window.sessionStorage.setItem('arche:flow-template:broken', JSON.stringify({ format: 'other' }))
    window.sessionStorage.setItem('arche:flow-template', 'broken')

    expect(consumeFlowTemplateDraft()).toBeNull()
    expect(window.sessionStorage.getItem('arche:flow-template')).toBeNull()
    expect(window.sessionStorage.getItem('arche:flow-template:broken')).toBeNull()
  })

  it('consumes legacy inline drafts', () => {
    const template = createTemplate()
    window.sessionStorage.setItem('arche:flow-template', JSON.stringify(template))

    expect(consumeFlowTemplateDraft()).toEqual(template)
  })
})
