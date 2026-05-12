'use client'

import { Plus, Trash } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AgentListItem } from '@/hooks/use-agents-catalog'
import type { FlowConditionRule, FlowDefinition, FlowNode } from '@/lib/flows/types'

type FlowNodeInspectorProps = {
  agents: AgentListItem[]
  definition: FlowDefinition
  selectedNode: FlowNode | null
  onDeleteNode: (nodeId: string) => void
  onUpdateDefinition: (definition: FlowDefinition) => void
  onUpdateNode: (node: FlowNode) => void
}

function createRule(targetNodeId: string): FlowConditionRule {
  return {
    id: `rule-${Date.now()}`,
    operator: 'contains',
    targetNodeId,
    value: '',
    variable: 'previous.output',
  }
}

export function FlowNodeInspector({
  agents,
  definition,
  selectedNode,
  onDeleteNode,
  onUpdateDefinition,
  onUpdateNode,
}: FlowNodeInspectorProps) {
  if (!selectedNode) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
        Select a node to edit its properties.
      </div>
    )
  }

  const node = selectedNode
  const outgoingEdge = definition.edges.find((edge) => edge.sourceNodeId === node.id)
  const targetOptions = definition.nodes.filter((candidate) => candidate.id !== node.id)

  function updateOutgoingTarget(targetNodeId: string) {
    const existing = definition.edges.find((edge) => edge.sourceNodeId === node.id)
    const edges = targetNodeId
      ? existing
        ? definition.edges.map((edge) => edge.id === existing.id ? { ...edge, targetNodeId } : edge)
        : [
            ...definition.edges,
            {
              id: `edge-${Date.now()}`,
              sourceNodeId: node.id,
              targetNodeId,
            },
          ]
      : definition.edges.filter((edge) => edge.sourceNodeId !== node.id)

    onUpdateDefinition({ ...definition, edges })
  }

  function updateRule(rule: FlowConditionRule) {
    if (node.type !== 'condition') return
    onUpdateNode({
      ...node,
      rules: (node.rules ?? []).map((candidate) => candidate.id === rule.id ? rule : candidate),
    })
  }

  return (
    <div className="space-y-5 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{node.type} node</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">Inspector</h3>
        </div>
        <Button variant="outline" size="sm" onClick={() => onDeleteNode(node.id)}>
          <Trash size={13} className="mr-1" /> Delete
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="flow-node-name">Name</Label>
        <Input
          id="flow-node-name"
          value={node.name}
          onChange={(event) => onUpdateNode({ ...node, name: event.target.value })}
        />
      </div>

      {node.type === 'agent' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="flow-node-agent">Target agent</Label>
            <select
              id="flow-node-agent"
              value={node.targetAgentId ?? ''}
              onChange={(event) => onUpdateNode({ ...node, targetAgentId: event.target.value || null })}
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Primary agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.displayName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="flow-node-prompt">Prompt template</Label>
            <textarea
              id="flow-node-prompt"
              value={node.promptTemplate}
              onChange={(event) => onUpdateNode({ ...node, promptTemplate: event.target.value })}
              rows={7}
              className="min-h-[150px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Compact output</p>
              <p className="text-xs text-muted-foreground">Run a same-session compaction prompt after this step.</p>
            </div>
            <Switch
              checked={node.compactOutput}
              onCheckedChange={(compactOutput) => onUpdateNode({ ...node, compactOutput })}
              aria-label="Compact agent output"
            />
          </div>
        </>
      ) : null}

      {node.type === 'human' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="flow-human-instructions">Instructions</Label>
            <textarea
              id="flow-human-instructions"
              value={node.instructions}
              onChange={(event) => onUpdateNode({ ...node, instructions: event.target.value })}
              rows={5}
              className="min-h-[120px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <p className="text-sm font-medium text-foreground">Response required</p>
            <Switch
              checked={node.required}
              onCheckedChange={(required) => onUpdateNode({ ...node, required })}
              aria-label="Require response"
            />
          </div>
        </>
      ) : null}

      {node.type === 'condition' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="flow-condition-mode">Mode</Label>
            <select
              id="flow-condition-mode"
              value={node.mode}
              onChange={(event) => onUpdateNode({
                ...node,
                evaluatorPrompt: event.target.value === 'ai' ? node.evaluatorPrompt ?? 'Choose the best next node based on the previous output.' : node.evaluatorPrompt,
                mode: event.target.value === 'ai' ? 'ai' : 'rules',
                rules: event.target.value === 'rules' ? node.rules ?? [createRule(targetOptions[0]?.id ?? node.id)] : node.rules,
              })}
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="rules">Simple rules</option>
              <option value="ai">AI evaluator</option>
            </select>
          </div>

          {node.mode === 'rules' ? (
            <div className="space-y-3">
              {(node.rules ?? []).map((rule) => (
                <div key={rule.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <Input value={rule.variable} onChange={(event) => updateRule({ ...rule, variable: event.target.value })} placeholder="previous.output" />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={rule.operator}
                      onChange={(event) => updateRule({ ...rule, operator: event.target.value as FlowConditionRule['operator'] })}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="starts_with">starts with</option>
                      <option value="ends_with">ends with</option>
                      <option value="exists">exists</option>
                      <option value="not_exists">not exists</option>
                      <option value="matches">regex matches</option>
                    </select>
                    <Input value={rule.value ?? ''} onChange={(event) => updateRule({ ...rule, value: event.target.value })} placeholder="Value" />
                  </div>
                  <select
                    value={rule.targetNodeId}
                    onChange={(event) => updateRule({ ...rule, targetNodeId: event.target.value })}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                  >
                    {targetOptions.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                  </select>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onUpdateNode({
                  ...node,
                  rules: [...(node.rules ?? []), createRule(targetOptions[0]?.id ?? node.id)],
                })}
              >
                <Plus size={13} className="mr-1" /> Add rule
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="flow-ai-condition-prompt">Evaluator prompt</Label>
              <textarea
                id="flow-ai-condition-prompt"
                value={node.evaluatorPrompt ?? ''}
                onChange={(event) => onUpdateNode({ ...node, evaluatorPrompt: event.target.value })}
                rows={5}
                className="min-h-[120px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}
        </>
      ) : null}

      {node.type === 'merge' ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Merge nodes are pass-through join markers. Flows still execute one path at a time and continue through the selected next node.
        </p>
      ) : null}

      {node.type !== 'condition' ? (
        <div className="space-y-2">
          <Label htmlFor="flow-next-node">Next node</Label>
          <select
            id="flow-next-node"
            value={outgoingEdge?.targetNodeId ?? ''}
            onChange={(event) => updateOutgoingTarget(event.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="">End flow</option>
            {targetOptions.map((node) => (
              <option key={node.id} value={node.id}>{node.name}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}
