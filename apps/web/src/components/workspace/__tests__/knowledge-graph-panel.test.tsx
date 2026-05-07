/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forceCollide, forceLink, forceManyBody } from 'd3-force'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeGraphPanel } from '@/components/workspace/knowledge-graph-panel'
import type { WorkspaceFileNode } from '@/lib/opencode/types'

const stopSimulationMock = vi.fn()

type ForceNode = {
  id: string
  kind: 'agent' | 'file'
  label: string
  path?: string
}

type ForceEdge = {
  id: string
  kind: 'agent-reference' | 'file-link'
  source: ForceNode | string
  target: ForceNode | string
}

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

function createMarkdownFileNodes(paths: string[]): WorkspaceFileNode[] {
  return [
    {
      id: 'notes',
      name: 'Notes',
      path: 'Notes',
      type: 'directory',
      children: paths.map((path) => ({
        id: path,
        name: path.split('/').pop() ?? path,
        path,
        type: 'file',
      })),
    },
  ]
}

function getRenderedNodeRadius(path: string): number {
  const node = screen.getByRole('button', { name: path })
  const circle = node.querySelector('circle')
  if (!circle) throw new Error(`Missing circle for ${path}`)
  return Number(circle.getAttribute('r'))
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

  it('renders larger file nodes for higher connection counts', async () => {
    const contentByPath: Record<string, string> = {
      'Notes/A.md': '[[Notes/B.md]] [[Notes/C.md]] [[Notes/D.md]] [[Notes/E.md]]',
    }
    const readFile = vi.fn(async (path: string) => ({
      content: contentByPath[path] ?? '',
      type: 'raw' as const,
    }))
    const fileNodes = createMarkdownFileNodes([
      'Notes/A.md',
      'Notes/B.md',
      'Notes/C.md',
      'Notes/D.md',
      'Notes/E.md',
      'Notes/F.md',
    ])

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
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(6))

    await waitFor(() => expect(getRenderedNodeRadius('Notes/A.md')).toBe(7.2))
    expect(getRenderedNodeRadius('Notes/B.md')).toBe(5.6)
    expect(getRenderedNodeRadius('Notes/F.md')).toBe(4)
  })

  it('uses node degree to configure link, charge, and collision forces', async () => {
    const contentByPath: Record<string, string> = {
      'Notes/A.md': '[[Notes/B.md]] [[Notes/C.md]] [[Notes/D.md]] [[Notes/E.md]]',
    }
    const readFile = vi.fn(async (path: string) => ({
      content: contentByPath[path] ?? '',
      type: 'raw' as const,
    }))
    const fileNodes = createMarkdownFileNodes([
      'Notes/A.md',
      'Notes/B.md',
      'Notes/C.md',
      'Notes/D.md',
      'Notes/E.md',
      'Notes/F.md',
    ])

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
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(screen.getByText('4 links')).toBeDefined())

    const forceLinkMock = vi.mocked(forceLink)
    const forceLinkResult = forceLinkMock.mock.results[
      forceLinkMock.mock.results.length - 1
    ]?.value
    if (!forceLinkResult) throw new Error('Missing link force')

    const distanceMock = vi.mocked(forceLinkResult.distance)
    const strengthMock = vi.mocked(forceLinkResult.strength)
    const distance = distanceMock.mock.calls[0]?.[0] as
      | ((edge: ForceEdge) => number)
      | undefined
    const strength = strengthMock.mock.calls[0]?.[0] as
      | ((edge: ForceEdge) => number)
      | undefined
    if (!distance || !strength) throw new Error('Missing link force callbacks')

    const hub: ForceNode = {
      id: 'file:Notes/A.md',
      kind: 'file',
      label: 'A',
      path: 'Notes/A.md',
    }
    const leaf: ForceNode = {
      id: 'file:Notes/B.md',
      kind: 'file',
      label: 'B',
      path: 'Notes/B.md',
    }
    const isolated: ForceNode = {
      id: 'file:Notes/F.md',
      kind: 'file',
      label: 'F',
      path: 'Notes/F.md',
    }

    expect(distance({ id: 'hub-link', kind: 'file-link', source: hub, target: leaf })).toBe(
      78
    )
    expect(strength({ id: 'hub-link', kind: 'file-link', source: hub, target: leaf })).toBe(
      0.36
    )
    expect(
      distance({ id: 'low-link', kind: 'file-link', source: leaf.id, target: isolated.id })
    ).toBe(96)

    const forceManyBodyMock = vi.mocked(forceManyBody)
    const chargeForce = forceManyBodyMock.mock.results[
      forceManyBodyMock.mock.results.length - 1
    ]?.value
    if (!chargeForce) throw new Error('Missing charge force')

    const chargeStrengthMock = vi.mocked(chargeForce.strength)
    const chargeStrength = chargeStrengthMock.mock.calls[0]?.[0] as
      | ((node: ForceNode) => number)
      | undefined
    if (!chargeStrength) throw new Error('Missing charge strength callback')

    expect(chargeStrength(hub)).toBe(-178)
    expect(chargeStrength(isolated)).toBe(-35)

    const forceCollideMock = vi.mocked(forceCollide)
    const collideRadius = forceCollideMock.mock.calls[
      forceCollideMock.mock.calls.length - 1
    ]?.[0] as ((node: ForceNode) => number) | undefined
    if (!collideRadius) throw new Error('Missing collide radius callback')

    expect(collideRadius(hub)).toBe(13.2)
    expect(collideRadius(isolated)).toBe(10)
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

    expect(force?.distanceMax).toHaveBeenCalledWith(180)
  })
})
