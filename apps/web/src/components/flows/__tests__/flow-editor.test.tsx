/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowDetail } from '@/lib/flows/types'
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
  FlowCanvas: ({ onSelectNode }: { onSelectNode: (nodeId: string) => void }) => (
    <button type="button" onClick={() => onSelectNode('agent-1')}>Canvas</button>
  ),
}))
vi.mock('@/components/flows/flow-node-inspector', () => ({
  FlowNodeInspector: ({ selectedNode }: { selectedNode: { name: string } | null }) => <div>Inspector {selectedNode?.name}</div>,
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
    timezone: 'UTC',
    updatedAt: '2026-05-12T10:00:00.000Z',
  }
}

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('renders load errors', async () => {
    mocks.fetchFlowDetail.mockResolvedValue({ ok: false, error: 'not_found' })

    render(<FlowEditor slug="alice" mode="edit" flowId="missing" />)

    await waitFor(() => expect(screen.getByText('Could not load flow')).toBeTruthy())
    expect(screen.getByText('not_found')).toBeTruthy()
  })
})
