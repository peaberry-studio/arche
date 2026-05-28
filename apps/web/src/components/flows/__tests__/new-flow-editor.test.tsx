/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NewFlowEditor } from '@/components/flows/new-flow-editor'
import { FLOW_TEMPLATE_FORMAT, type FlowTemplate } from '@/lib/flows/import-export'
import { storeFlowTemplateDraft } from '@/lib/flows/template-session'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

type MockFlowEditorProps = {
  initialTemplate?: FlowTemplate
  mode: string
  slug: string
}

const mocks = vi.hoisted(() => ({
  flowEditorProps: vi.fn(),
}))

vi.mock('@/components/flows/flow-editor', () => ({
  FlowEditor: (props: MockFlowEditorProps) => {
    mocks.flowEditorProps(props)
    return <div data-testid="flow-editor">{props.initialTemplate?.name ?? 'No template'}</div>
  },
}))

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

describe('NewFlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('consumes stored template drafts after mount', async () => {
    const template = createTemplate()
    storeFlowTemplateDraft(template)

    render(<NewFlowEditor slug="alice" />)

    await waitFor(() => expect(screen.getByTestId('flow-editor').textContent).toBe('Imported flow'))
    expect(mocks.flowEditorProps).toHaveBeenLastCalledWith({
      buildFlowHref: undefined,
      flowListHref: undefined,
      initialTemplate: template,
      mode: 'create',
      slackIntegrationAvailable: undefined,
      slug: 'alice',
      teamVisibilityAvailable: undefined,
    })
    expect(window.sessionStorage.getItem('arche:flow-template')).toBeNull()
  })
})
