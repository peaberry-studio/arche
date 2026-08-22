/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceFlowsOverlay } from '@/components/workspace/workspace-flows-overlay'
import { FLOW_TEMPLATE_FORMAT, type FlowTemplate } from '@/lib/flows/import-export'
import { storeFlowTemplateDraft } from '@/lib/flows/template-session'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams('flows=list'),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/alice',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.search,
}))

vi.mock('@/components/flows/flows-page', () => ({
  FlowsPage: ({
    buildCreateHref,
    buildEditHref,
    buildHistoryHref,
    slug,
  }: {
    buildCreateHref?: () => string
    buildEditHref?: (flowId: string) => string
    buildHistoryHref?: (flowId: string) => string
    slug: string
  }) => (
    <div data-testid="flows-page" data-slug={slug}>
      <a href={buildCreateHref?.()}>Create href</a>
      <a href={buildEditHref?.('flow-1')}>Edit href</a>
      <a href={buildHistoryHref?.('flow-1')}>History href</a>
    </div>
  ),
}))

vi.mock('@/components/flows/flow-editor', () => ({
  FlowEditor: ({
    buildFlowHref,
    flowId,
    flowListHref,
    initialTemplate,
    mode,
    slackIntegrationAvailable,
    teamVisibilityAvailable,
  }: {
    buildFlowHref?: (flowId: string) => string
    flowId?: string
    flowListHref?: string
    initialTemplate?: FlowTemplate
    mode: 'create' | 'edit'
    slackIntegrationAvailable?: boolean
    teamVisibilityAvailable?: boolean
  }) => (
    <div
      data-testid="flow-editor"
      data-build-flow-href={buildFlowHref?.('created-flow')}
      data-flow-id={flowId ?? ''}
      data-flow-list-href={flowListHref}
      data-mode={mode}
      data-slack={String(slackIntegrationAvailable)}
      data-team={String(teamVisibilityAvailable)}
      data-template-name={initialTemplate?.name ?? ''}
    />
  ),
}))

vi.mock('@/components/flows/flow-run-history-view', () => ({
  FlowRunHistoryView: ({ editHref, flowId, slug }: { editHref?: string; flowId: string; slug: string }) => (
    <div data-testid="flow-run-history-view" data-edit-href={editHref} data-flow-id={flowId} data-slug={slug} />
  ),
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

describe('WorkspaceFlowsOverlay', () => {
  beforeEach(() => {
    navigation.replace.mockReset()
    navigation.search = new URLSearchParams('flows=list')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the list view with workspace flow href builders', () => {
    render(<WorkspaceFlowsOverlay slug="alice" />)

    expect(screen.getByTestId('flows-page').dataset.slug).toBe('alice')
    expect(screen.getByRole('link', { name: 'Create href' }).getAttribute('href')).toBe('/w/alice?flows=new')
    expect(screen.getByRole('link', { name: 'Edit href' }).getAttribute('href')).toBe('/w/alice?flows=edit&flowId=flow-1')
    expect(screen.getByRole('link', { name: 'History href' }).getAttribute('href')).toBe('/w/alice?flows=runs&flowId=flow-1')
  })

  it('preserves the session parameter in flow hrefs', () => {
    navigation.search = new URLSearchParams('flows=list&session=session-1')

    render(<WorkspaceFlowsOverlay slug="alice" />)

    expect(screen.getByRole('link', { name: 'Create href' }).getAttribute('href')).toBe('/w/alice?session=session-1&flows=new')
    expect(screen.getByRole('link', { name: 'Edit href' }).getAttribute('href')).toBe('/w/alice?session=session-1&flows=edit&flowId=flow-1')
  })

  it('removes flow query state when closed', () => {
    navigation.search = new URLSearchParams('mode=knowledge&flows=runs&flowId=flow-1&run=run-1')

    render(<WorkspaceFlowsOverlay slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close flows' }))

    expect(navigation.replace).toHaveBeenCalledWith('/w/alice?mode=knowledge')
  })

  it('renders create view with list and created-flow hrefs', () => {
    navigation.search = new URLSearchParams('flows=new')

    render(
      <WorkspaceFlowsOverlay
        slug="alice"
        slackIntegrationAvailable
        teamVisibilityAvailable
      />,
    )

    const editor = screen.getByTestId('flow-editor')
    expect(editor.dataset.mode).toBe('create')
    expect(editor.dataset.flowListHref).toBe('/w/alice?flows=list')
    expect(editor.dataset.buildFlowHref).toBe('/w/alice?flows=edit&flowId=created-flow')
    expect(editor.dataset.slack).toBe('true')
    expect(editor.dataset.team).toBe('true')
  })

  it('consumes stored template drafts when rendering the create view', async () => {
    storeFlowTemplateDraft(createTemplate())
    navigation.search = new URLSearchParams('flows=new')

    render(<WorkspaceFlowsOverlay slug="alice" />)

    await waitFor(() => expect(screen.getByTestId('flow-editor').dataset.templateName).toBe('Imported flow'))
    expect(window.sessionStorage.getItem('arche:flow-template')).toBeNull()
  })

  it('renders edit view with a run history link', () => {
    navigation.search = new URLSearchParams('flows=edit&flowId=flow-1')

    render(<WorkspaceFlowsOverlay slug="alice" />)

    const editor = screen.getByTestId('flow-editor')
    expect(editor.dataset.mode).toBe('edit')
    expect(editor.dataset.flowId).toBe('flow-1')
    expect(screen.getByRole('link', { name: /run history/i }).getAttribute('href')).toBe('/w/alice?flows=runs&flowId=flow-1')
  })

  it('shows a missing-flow fallback for detail views without a flow id', () => {
    navigation.search = new URLSearchParams('flows=edit')

    render(<WorkspaceFlowsOverlay slug="alice" />)

    expect(screen.getByText('Missing flow')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to flows' }).getAttribute('href')).toBe('/w/alice?flows=list')
  })

  it('renders run history with an edit href', () => {
    navigation.search = new URLSearchParams('flows=runs&flowId=flow-1')

    render(<WorkspaceFlowsOverlay slug="alice" />)

    const history = screen.getByTestId('flow-run-history-view')
    expect(history.dataset.slug).toBe('alice')
    expect(history.dataset.flowId).toBe('flow-1')
    expect(history.dataset.editHref).toBe('/w/alice?flows=edit&flowId=flow-1')
  })
})
