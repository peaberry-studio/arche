/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowNodeInspector } from '@/components/flows/flow-node-inspector'
import type { FlowDefinition } from '@/lib/flows/types'

const definition: FlowDefinition = {
  edges: [],
  nodes: [
    { compactOutput: false, id: 'agent-1', name: 'Agent', promptTemplate: 'Prompt', targetAgentId: null, type: 'agent' },
    { id: 'human-1', instructions: 'Review', name: 'Human', required: true, type: 'human' },
    { id: 'condition-1', mode: 'rules', name: 'Condition', rules: [{ id: 'rule-1', operator: 'contains', targetNodeId: 'human-1', value: 'yes', variable: 'previous.output' }], type: 'condition' },
    { id: 'slack-1', messageMode: 'fixed', messageTemplate: 'Hello', name: 'Slack', target: { type: 'dm', userId: 'user-1' }, type: 'slack' },
    { id: 'merge-1', name: 'Merge', type: 'merge' },
  ],
  startNodeId: 'agent-1',
  version: 1,
}

const connectedDefinition: FlowDefinition = {
  ...definition,
  edges: [
    { id: 'edge-1', sourceNodeId: 'agent-1', targetNodeId: 'human-1' },
    { id: 'edge-2', sourceNodeId: 'human-1', targetNodeId: 'condition-1' },
  ],
}

function renderInspector(props: Partial<Parameters<typeof FlowNodeInspector>[0]> = {}) {
  return render(
    <FlowNodeInspector
      agents={[]}
      definition={definition}
      selectedNode={null}
      slackChannels={[{ channelId: 'C1', isPrivate: false, name: 'ops' }]}
      slackIntegrationEnabled
      slackUsers={[{ email: 'alice@example.com', id: 'user-1', slackLinked: true }]}
      onDeleteNode={vi.fn()}
      onUpdateNode={vi.fn()}
      {...props}
    />,
  )
}

describe('FlowNodeInspector', () => {
  afterEach(() => cleanup())

  it('renders an empty selection message', () => {
    renderInspector()

    expect(screen.getByText('Select a node to edit its properties.')).toBeTruthy()
  })

  it('updates agent properties', () => {
    const onUpdateNode = vi.fn()
    render(
      <FlowNodeInspector
        agents={[{ displayName: 'Writer', id: 'writer', isPrimary: false, usesDefaultModel: true }]}
        definition={definition}
        selectedNode={definition.nodes[0]}
        slackChannels={[]}
        slackIntegrationEnabled
        slackUsers={[]}
        onDeleteNode={vi.fn()}
        onUpdateNode={onUpdateNode}
      />,
    )

    fireEvent.change(screen.getByLabelText('Target agent'), { target: { value: 'writer' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ targetAgentId: 'writer' }))
    expect(screen.getByText('Create or remove step connections directly on the canvas.')).toBeTruthy()
  })

  it('updates human node fields', () => {
    const onUpdateNode = vi.fn()
    renderInspector({ definition: connectedDefinition, selectedNode: connectedDefinition.nodes[1], onUpdateNode })

    expect(screen.getByText('human-1')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Approve this output' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'Approve this output' }))

    fireEvent.click(screen.getByRole('button', { name: /\{\{previous\.output\}\}/ }))
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'Review {{previous.output}}' }))
    expect(screen.getByText('{{human.human-1.response}}')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Require response' }))
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ required: false }))
  })

  it('suggests raw variables for condition rules', () => {
    const onUpdateNode = vi.fn()
    renderInspector({ definition: connectedDefinition, selectedNode: connectedDefinition.nodes[2], onUpdateNode })

    fireEvent.click(screen.getByRole('button', { name: /human\.human-1\.response/ }))

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ variable: 'human.human-1.response' })],
    }))
  })

  it('updates condition rules and mode', () => {
    const onUpdateNode = vi.fn()
    renderInspector({ selectedNode: definition.nodes[2], onUpdateNode })

    fireEvent.change(screen.getByDisplayValue('previous.output'), { target: { value: 'flow.name' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ variable: 'flow.name' })],
    }))

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'ai' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ai' }))
  })

  it('adds rules and updates AI evaluator prompts', () => {
    const onUpdateNode = vi.fn()
    renderInspector({ selectedNode: definition.nodes[2], onUpdateNode })

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.any(Object), expect.objectContaining({ targetNodeId: 'agent-1' })],
    }))

    cleanup()

    const aiCondition = { ...definition.nodes[2], evaluatorPrompt: 'Pick one', mode: 'ai' as const }
    renderInspector({ selectedNode: aiCondition, onUpdateNode })
    fireEvent.change(screen.getByLabelText('Evaluator prompt'), { target: { value: 'Choose carefully' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ evaluatorPrompt: 'Choose carefully' }))
  })

  it('updates Slack node target and message settings', () => {
    const onUpdateNode = vi.fn()
    renderInspector({ selectedNode: definition.nodes[3], onUpdateNode })

    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'channel' } })
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ target: { type: 'channel', channelId: 'C1' } }))

    cleanup()
    renderInspector({ selectedNode: { ...definition.nodes[3], target: { type: 'channel', channelId: 'C1' } }, onUpdateNode })
    fireEvent.change(screen.getByLabelText('Slack channel target'), { target: { value: 'C1' } })
    fireEvent.change(screen.getByLabelText('Message source'), { target: { value: 'template' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Report: {{previous.output}}' } })

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ target: { type: 'channel', channelId: 'C1' } }))
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ messageMode: 'template' }))
    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({ messageTemplate: 'Report: {{previous.output}}' }))
  })

  it('documents merge nodes as pass-through markers', () => {
    renderInspector({ selectedNode: definition.nodes[4] })

    expect(screen.getByText(/Merge nodes are pass-through join markers/)).toBeTruthy()
  })
})
