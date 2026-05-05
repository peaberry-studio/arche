/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forceManyBody } from 'd3-force'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeGraphPanel } from '@/components/workspace/knowledge-graph-panel'
import type { WorkspaceFileNode } from '@/lib/opencode/types'

const stopSimulationMock = vi.fn()

function chainableForce() {
  const force = {
    distanceMax: vi.fn(() => force),
    distance: vi.fn(() => force),
    id: vi.fn(() => force),
    strength: vi.fn(() => force),
  }
  return force
}

vi.mock('d3-force', () => ({
  forceCenter: vi.fn(() => chainableForce()),
  forceCollide: vi.fn(() => chainableForce()),
  forceLink: vi.fn(() => chainableForce()),
  forceManyBody: vi.fn(() => chainableForce()),
  forceSimulation: vi.fn(() => {
    const simulation = {
      alpha: vi.fn(() => simulation),
      alphaDecay: vi.fn(() => simulation),
      alphaTarget: vi.fn(() => simulation),
      force: vi.fn(() => simulation),
      on: vi.fn((_event: string, callback: () => void) => {
        callback()
        return simulation
      }),
      restart: vi.fn(() => simulation),
      stop: stopSimulationMock,
    }
    return simulation
  }),
  forceX: vi.fn(() => chainableForce()),
  forceY: vi.fn(() => chainableForce()),
}))

function chainableBehavior() {
  const behavior = vi.fn()
  Object.assign(behavior, {
    clickDistance: vi.fn(() => behavior),
    filter: vi.fn(() => behavior),
    on: vi.fn(() => behavior),
    scaleExtent: vi.fn(() => behavior),
  })
  return behavior
}

vi.mock('d3-drag', () => ({
  drag: vi.fn(() => chainableBehavior()),
}))

vi.mock('d3-selection', () => ({
  select: vi.fn(() => {
    const selection = {
      call: vi.fn(() => selection),
      datum: vi.fn(() => selection),
      on: vi.fn(() => selection),
    }
    return selection
  }),
}))

vi.mock('d3-zoom', () => ({
  zoom: vi.fn(() => chainableBehavior()),
  zoomIdentity: {
    k: 1,
    toString: () => 'translate(0,0) scale(1)',
  },
}))

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe() {
    this.callback([
      {
        contentRect: { width: 640, height: 360 } as DOMRectReadOnly,
      } as ResizeObserverEntry,
    ], this)
  }

  disconnect() {}

  unobserve() {}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('KnowledgeGraphPanel', () => {
  it('renders an empty state when there are no markdown files', async () => {
    const readFile = vi.fn(async () => null)

    render(
      <KnowledgeGraphPanel
        activeFilePath={null}
        agentSources={[]}
        fileNodes={[]}
        onOpenFile={vi.fn()}
        openFiles={[]}
        readFile={readFile}
        reloadKey={0}
      />
    )

    expect(screen.getByText('Add markdown files to your Knowledge Base to build the graph.')).toBeDefined()
    await waitFor(() => expect(readFile).not.toHaveBeenCalled())
  })

  it('renders file and agent graph nodes, summaries, and open-file interactions', async () => {
    const onOpenFile = vi.fn()
    const readFile = vi.fn(async (path: string) => ({
      content: path === 'Notes/B.md' ? 'Backlinks to [[Notes/A]]' : '',
      type: 'raw' as const,
    }))
    const fileNodes: WorkspaceFileNode[] = [
      {
        id: 'notes',
        name: 'Notes',
        path: 'Notes',
        type: 'directory',
        children: [
          { id: 'a', name: 'A.md', path: 'Notes/A.md', type: 'file' },
          { id: 'b', name: 'B.md', path: 'Notes/B.md', type: 'file' },
          { id: 'txt', name: 'Skip.txt', path: 'Notes/Skip.txt', type: 'file' },
        ],
      },
    ]

    render(
      <KnowledgeGraphPanel
        activeFilePath="Notes/A.md"
        agentSources={[{ id: 'agent-1', displayName: 'Research Agent', prompt: 'Use Notes/B.md' }]}
        fileNodes={fileNodes}
        onOpenFile={onOpenFile}
        openFiles={[{ path: 'Notes/A.md', content: 'Read [B](Notes/B.md)' }]}
        readFile={readFile}
        reloadKey={0}
      />
    )

    expect(await screen.findByRole('img', { name: 'Knowledge graph' })).toBeDefined()
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))

    const fileA = screen.getByRole('button', { name: 'Notes/A.md' })
    const fileB = screen.getByRole('button', { name: 'Notes/B.md' })
    expect(screen.getByRole('img', { name: 'Research Agent' })).toBeDefined()
    expect(screen.getByText('2 files')).toBeDefined()
    expect(screen.getByText('1 agent')).toBeDefined()
    expect(screen.getByText('3 links')).toBeDefined()

    fireEvent.mouseEnter(fileA)
    fireEvent.click(fileA)
    fireEvent.keyDown(fileB, { key: 'Enter' })

    expect(onOpenFile).toHaveBeenCalledWith('Notes/A.md')
    expect(onOpenFile).toHaveBeenCalledWith('Notes/B.md')
  })

  it('limits charge range so disconnected graph groups stay closer together', async () => {
    const readFile = vi.fn(async (path: string) => ({
      content: path.endsWith('A.md') ? 'See [[Notes/B.md]]' : path.endsWith('C.md') ? 'See [[Notes/D.md]]' : '',
      type: 'raw' as const,
    }))
    const fileNodes: WorkspaceFileNode[] = [
      {
        id: 'notes',
        name: 'Notes',
        path: 'Notes',
        type: 'directory',
        children: [
          { id: 'a', name: 'A.md', path: 'Notes/A.md', type: 'file' },
          { id: 'b', name: 'B.md', path: 'Notes/B.md', type: 'file' },
          { id: 'c', name: 'C.md', path: 'Notes/C.md', type: 'file' },
          { id: 'd', name: 'D.md', path: 'Notes/D.md', type: 'file' },
        ],
      },
    ]

    render(
      <KnowledgeGraphPanel
        activeFilePath={null}
        agentSources={[]}
        fileNodes={fileNodes}
        onOpenFile={vi.fn()}
        openFiles={[]}
        readFile={readFile}
        reloadKey={0}
      />
    )

    expect(await screen.findByRole('img', { name: 'Knowledge graph' })).toBeDefined()
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(4))

    const forceManyBodyMock = vi.mocked(forceManyBody)
    const results = forceManyBodyMock.mock.results
    const force = results[results.length - 1]?.value

    expect(force?.distanceMax).toHaveBeenCalledWith(240)
  })
})
