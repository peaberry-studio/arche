/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowEditor } from '@/components/flows/flow-editor'
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
  FlowCanvas: ({ onMoveNode, onSelectNode }: { onMoveNode: (nodeId: string, x: number, y: number) => void; onSelectNode: (nodeId: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSelectNode('agent-1')}>Canvas</button>
      <button type="button" onClick={() => onMoveNode('agent-1', 240, 180)}>Move existing node</button>
      <button type="button" onClick={() => onMoveNode('loose-node', 320, 220)}>Move loose node</button>
    </div>
  ),
}))
vi.mock('@/components/flows/flow-node-inspector', () => ({
  FlowNodeInspector: ({
    definition,
    onDeleteNode,
    onUpdateDefinition,
    onUpdateNode,
    selectedNode,
  }: {
    definition: FlowDefinition
    onDeleteNode: (nodeId: string) => void
    onUpdateDefinition: (definition: FlowDefinition) => void
    onUpdateNode: (node: FlowNode) => void
    selectedNode: FlowNode | null
  }) => (
    <div>
      <div>Inspector {selectedNode?.name}</div>
      <button type="button" onClick={() => selectedNode ? onUpdateNode({ ...selectedNode, name: 'Renamed node' }) : undefined}>Rename selected node</button>
      <button type="button" onClick={() => selectedNode ? onDeleteNode(selectedNode.id) : undefined}>Delete selected node</button>
      <button
        type="button"
        onClick={() => onUpdateDefinition({
          ...definition,
          nodes: definition.nodes.filter((node) => node.id !== selectedNode?.id),
          startNodeId: definition.nodes.find((node) => node.id !== selectedNode?.id)?.id ?? '',
        })}
      >
        Drop selected from definition
      </button>
    </div>
  ),
}))
vi.mock('@/components/flows/flow-run-history', () => ({
  FlowRunHistory: () => <div>Run history</div>,
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
    runs: [],
    slackNotificationConfig: null,
    timezone: 'UTC',
    updatedAt: '2026-05-12T10:00:00.000Z',
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

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Human' }))
    fireEvent.click(screen.getByRole('button', { name: 'Condition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move existing node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move loose node' }))

    const [sourceSelect, targetSelect] = screen.getAllByRole('combobox').slice(-2) as HTMLSelectElement[]
    const sourceOption = Array.from(sourceSelect.options).find((option) => option.text === 'First agent step')
    const targetOption = Array.from(targetSelect.options).find((option) => option.text === 'Human step 3')
    expect(sourceOption).toBeTruthy()
    expect(targetOption).toBeTruthy()
    fireEvent.change(sourceSelect, { target: { value: sourceOption?.value } })
    fireEvent.change(targetSelect, { target: { value: targetOption?.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))

    expect(screen.getByText(/First agent step -> Human step 3/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename selected node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop selected from definition' }))
  })

  it('creates Slack notification targets for DMs and channels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        channels: [{ channelId: 'C1', isPrivate: true, name: 'ops' }],
        integrationEnabled: true,
        users: [{ email: 'alice@example.com', id: 'user-1', slackLinked: true }],
      }),
      ok: true,
    }))
    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(screen.getByText('Slack notifications')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: 'Slack notifications' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))
    expect(screen.getByText('Add at least one Slack notification target.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Slack DM target'), { target: { value: 'user-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    expect(screen.getByText('DM: alice@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByLabelText('Send to channel'))
    fireEvent.change(screen.getByLabelText('Slack channel target'), { target: { value: 'C1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Include session link' }))
    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Notify flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    await waitFor(() => expect(mocks.createFlowRequest).toHaveBeenCalledWith('alice', expect.objectContaining({
      name: 'Notify flow',
      slackNotificationConfig: {
        enabled: true,
        includeSessionLink: false,
        targets: [{ channelId: 'C1', type: 'channel' }],
      },
    })))
  })

  it('loads existing Slack notification config and clears it when disabled', async () => {
    const flow = createFlowDetail()
    flow.slackNotificationConfig = {
      enabled: true,
      includeSessionLink: false,
      targets: [{ type: 'dm', userId: 'user-1' }],
    }
    mocks.fetchFlowDetail.mockResolvedValue({ ok: true, data: { flow } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        channels: [],
        integrationEnabled: true,
        users: [{ email: 'alice@example.com', id: 'user-1', slackLinked: true }],
      }),
      ok: true,
    }))

    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByText('DM: alice@example.com')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: 'Slack notifications' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.updateFlowRequest).toHaveBeenCalledWith('alice', 'flow-1', expect.objectContaining({
      slackNotificationConfig: null,
    })))
  })

  it('handles Slack target load failures without blocking the editor', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('[flow-editor] Failed to load Slack targets', expect.any(Error)))
    expect(screen.queryByText('Slack notifications')).toBeNull()
  })

  it('shows Slack channel empty state when no channels are configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ channels: [], integrationEnabled: true, users: [] }),
      ok: true,
    }))

    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(screen.getByText('Slack notifications')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: 'Slack notifications' }))
    fireEvent.click(screen.getByLabelText('Send to channel'))

    expect(screen.getByText('No channels available. Configure notification channels in Slack settings.')).toBeTruthy()
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
    await waitFor(() => expect(screen.getByText('flow_busy')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(screen.getByText('not_found')).toBeTruthy())
  })

  it('renders network errors while loading and saving', async () => {
    mocks.fetchFlowDetail.mockRejectedValueOnce(new Error('offline'))
    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByText('network_error')).toBeTruthy())
    cleanup()

    mocks.createFlowRequest.mockRejectedValueOnce(new Error('offline'))
    render(<FlowEditor slug="alice" mode="create" />)
    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Network flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    await waitFor(() => expect(screen.getByText('network_error')).toBeTruthy())
  })

  it('renders network errors while running and deleting', async () => {
    mocks.runFlowRequest.mockRejectedValueOnce(new Error('offline'))
    mocks.deleteFlowRequest.mockRejectedValueOnce(new Error('offline'))

    render(<FlowEditor slug="alice" mode="edit" flowId="flow-1" />)

    await waitFor(() => expect(screen.getByDisplayValue('Existing flow')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Run flow' }))
    await waitFor(() => expect(screen.getByText('network_error')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(screen.getByText('network_error')).toBeTruthy())
  })

  it('skips Slack controls when target loading returns an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(null),
      ok: false,
    }))

    render(<FlowEditor slug="alice" mode="create" />)

    await waitFor(() => expect(screen.queryByText('Slack notifications')).toBeNull())
  })

  it('renders load errors', async () => {
    mocks.fetchFlowDetail.mockResolvedValue({ ok: false, error: 'not_found' })

    render(<FlowEditor slug="alice" mode="edit" flowId="missing" />)

    await waitFor(() => expect(screen.getByText('Could not load flow')).toBeTruthy())
    expect(screen.getByText('not_found')).toBeTruthy()
  })
})
