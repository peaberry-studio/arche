/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowTemplate } from '@/lib/flows/import-export'
import type { FlowDefinition, FlowDetail, FlowNode } from '@/lib/flows/types'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

const mocks = vi.hoisted(() => ({
  createFlowRequest: vi.fn(),
  deleteFlowRequest: vi.fn(),
  fetchFlowDetail: vi.fn(),
  push: vi.fn(),
  runFlowRequest: vi.fn(),
  updateFlowRequest: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/hooks/use-agents-catalog', () => ({ useAgentsCatalog: () => ({ agents: [] }) }))
vi.mock('@/lib/flows/client', () => ({
  createFlowRequest: mocks.createFlowRequest,
  deleteFlowRequest: mocks.deleteFlowRequest,
  fetchFlowDetail: mocks.fetchFlowDetail,
  runFlowRequest: mocks.runFlowRequest,
  updateFlowRequest: mocks.updateFlowRequest,
}))
vi.mock('@/components/flows/flow-canvas', () => ({
  FlowCanvas: ({
    definition,
    onAddNodeAfter,
    onConnectNodes,
    onEditNode,
    onMoveNode,
    onRemoveConnection,
    onSelectNode,
  }: {
    definition: FlowDefinition
    onAddNodeAfter: (sourceNodeId: string, type: FlowNode['type']) => void
    onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void
    onEditNode: (nodeId: string) => void
    onMoveNode: (nodeId: string, x: number, y: number) => void
    onRemoveConnection: (edgeId: string) => void
    onSelectNode: (nodeId: string) => void
  }) => {
    const humanNode = definition.nodes.find((node) => node.type === 'human')

    return (
    <div>
      <button type="button" onClick={() => onSelectNode('agent-1')}>Canvas</button>
      <button type="button" onClick={() => onEditNode('agent-1')}>Open node editor</button>
      <button type="button" onClick={() => onAddNodeAfter('agent-1', 'human')}>Add human after agent</button>
      <button type="button" onClick={() => humanNode ? onConnectNodes('agent-1', humanNode.id) : undefined}>Connect agent to human</button>
      <button type="button" onClick={() => onMoveNode('agent-1', 240, 180)}>Move existing node</button>
      <button type="button" onClick={() => onMoveNode('loose-node', 320, 220)}>Move loose node</button>
      {definition.edges.map((edge) => (
        <div key={edge.id}>
          <span>{`${edge.sourceNodeId}->${edge.targetNodeId}`}</span>
          <button type="button" onClick={() => onRemoveConnection(edge.id)}>Remove edge</button>
        </div>
      ))}
    </div>
    )
  },
}))
vi.mock('@/components/flows/flow-node-inspector', () => ({
  FlowNodeInspector: ({
    onDeleteNode,
    onUpdateNode,
    selectedNode,
  }: {
    onDeleteNode: (nodeId: string) => void
    onUpdateNode: (node: FlowNode) => void
    selectedNode: FlowNode | null
  }) => (
    <div>
      <div>Inspector {selectedNode?.name}</div>
      <button type="button" onClick={() => selectedNode ? onUpdateNode({ ...selectedNode, name: 'Renamed node' }) : undefined}>Rename selected node</button>
      <button type="button" onClick={() => selectedNode ? onDeleteNode(selectedNode.id) : undefined}>Delete selected node</button>
    </div>
  ),
}))
function createFlowDetail(): FlowDetail {
  return {
    createdAt: '2026-05-12T10:00:00.000Z',
    cronExpression: null,
    definition: createDefaultFlowDefinition(),
    description: 'Description',
    enabled: false,
    id: 'flow-1',
    lastRunAt: null,
    latestRun: null,
    name: 'Existing flow',
    nextRunAt: null,
    organizationCanRun: false,
    owner: { slug: 'alice' },
    permissions: { canCopy: true, canEdit: true, canManage: true, canRun: true, canView: true, isOwner: true },
    runs: [],
    timezone: 'UTC',
    updatedAt: '2026-05-12T10:00:00.000Z',
    visibility: 'private',
  }
}

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    const flow = createFlowDetail()
    mocks.fetchFlowDetail.mockResolvedValue({ ok: true, data: { flow } })
    mocks.createFlowRequest.mockResolvedValue({ ok: true, data: { flow } })
    mocks.updateFlowRequest.mockResolvedValue({ ok: true, data: { flow } })
    mocks.deleteFlowRequest.mockResolvedValue({ ok: true, data: { ok: true } })
    mocks.runFlowRequest.mockResolvedValue({ ok: true, data: { ok: true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ channels: [], integrationEnabled: false, users: [] }),
      ok: true,
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates a flow and navigates to it', async () => {
    render(<FlowEditor slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'New flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    await waitFor(() => expect(mocks.createFlowRequest).toHaveBeenCalledWith('alice', expect.objectContaining({ name: 'New flow' })))
    expect(mocks.push).toHaveBeenCalledWith('/u/alice/flows/flow-1')
  })

  it('loads an initial imported template as an unsaved draft', async () => {
    const definition = createDefaultFlowDefinition()
    const template: FlowTemplate = {
      cronExpression: null,
      definition,
      description: 'Imported description',
      enabled: false,
      format: 'arche-flow-template/v1',
      name: 'Imported flow',
      timezone: 'UTC',
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/flows/import/validate')) {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({
            payload: {
              cronExpression: null,
              definition,
              description: 'Imported description',
              enabled: false,
              name: 'Imported flow',
              organizationCanRun: false,
              timezone: 'UTC',
              visibility: 'private',
            },
            template,
            warnings: [{ code: 'unknown_target_agent', message: 'Review target agents before saving.' }],
          }),
          ok: true,
        })
      }

      return Promise.resolve({
        json: vi.fn().mockResolvedValue({ channels: [], integrationEnabled: false, users: [] }),
        ok: true,
      })
    }))

    render(<FlowEditor slug="alice" mode="create" initialTemplate={template} />)

    await waitFor(() => expect(screen.getByDisplayValue('Imported flow')).toBeTruthy())
    expect(screen.getByText('Review target agents before saving.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))
    await waitFor(() => expect(mocks.createFlowRequest).toHaveBeenCalledWith('alice', expect.objectContaining({
      description: 'Imported description',
      name: 'Imported flow',
    })))
  })

  it('keeps step ids readable when renaming nodes', async () => {
    render(<FlowEditor slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Semantic flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open node editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename selected node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    await waitFor(() => expect(mocks.createFlowRequest).toHaveBeenCalledWith('alice', expect.objectContaining({
      definition: expect.objectContaining({
        layout: { nodes: [expect.objectContaining({ nodeId: 'renamed-node' })] },
        nodes: [expect.objectContaining({ id: 'renamed-node', name: 'Renamed node' })],
        startNodeId: 'renamed-node',
      }),
      name: 'Semantic flow',
    })))
  })

  it('loads, runs, saves, and deletes an existing flow', async () => {
    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByDisplayValue('Existing flow')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Run flow' }))
    await waitFor(() => expect(mocks.runFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.updateFlowRequest).toHaveBeenCalledWith('alice', 'flow-1', expect.objectContaining({ description: 'Updated' })))

    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(mocks.deleteFlowRequest).toHaveBeenCalledWith('alice', 'flow-1'))
    expect(mocks.push).toHaveBeenCalledWith('/u/alice/flows')
  })

  it('updates graph nodes, layout, and connections', async () => {
    render(<FlowEditor slug="alice" mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Add human after agent' }))
    expect(screen.getByText('Inspector Human step 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('agent-1->human-step-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect agent to human' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move existing node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move loose node' }))

    fireEvent.click(screen.getByRole('button', { name: 'Remove edge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open node editor' }))
    expect(screen.getByText('Inspector First agent step')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rename selected node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected node' }))
  })

  it('handles Slack target load failures without blocking the editor', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('[flow-editor] Failed to load Slack targets', expect.any(Error)))
    expect(screen.getByLabelText('Flow name')).toBeTruthy()
  })

  it('surfaces save, run, and delete errors', async () => {
    mocks.createFlowRequest.mockResolvedValue({ ok: false, error: 'invalid_body' })
    render(<FlowEditor slug="alice" mode="create" />)

    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Broken flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))
    await waitFor(() => expect(screen.getByText('invalid_body')).toBeTruthy())
    cleanup()

    mocks.runFlowRequest.mockResolvedValue({ ok: false, error: 'flow_busy' })
    mocks.deleteFlowRequest.mockResolvedValue({ ok: false, error: 'not_found' })
    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByDisplayValue('Existing flow')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Run flow' }))
    await waitFor(() => expect(screen.getByText('This flow already has a run in progress. Try again after it finishes.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(screen.getByText('not_found')).toBeTruthy())
  })

  it('renders network errors while loading and saving', async () => {
    mocks.fetchFlowDetail.mockRejectedValueOnce(new Error('offline'))
    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByText('Network error. Try again.')).toBeTruthy())
    cleanup()

    mocks.createFlowRequest.mockRejectedValueOnce(new Error('offline'))
    render(<FlowEditor slug="alice" mode="create" />)
    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Network flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    await waitFor(() => expect(screen.getByText('Network error. Try again.')).toBeTruthy())
  })

  it('renders network errors while running and deleting', async () => {
    mocks.runFlowRequest.mockRejectedValueOnce(new Error('offline'))
    mocks.deleteFlowRequest.mockRejectedValueOnce(new Error('offline'))

    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByDisplayValue('Existing flow')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Run flow' }))
    await waitFor(() => expect(screen.getByText('Network error. Try again.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(screen.getByText('Network error. Try again.')).toBeTruthy())
  })

  it('continues when Slack target loading returns an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(null),
      ok: false,
    }))

    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(screen.getByLabelText('Flow name')).toBeTruthy())
  })

  it('renders load errors', async () => {
    mocks.fetchFlowDetail.mockResolvedValue({ ok: false, error: 'not_found' })

    render(<FlowEditor slug="alice" mode="edit" flowId="missing" />)

    await waitFor(() => expect(screen.getByText('Could not load flow')).toBeTruthy())
    expect(screen.getByText('not_found')).toBeTruthy()
  })
})
