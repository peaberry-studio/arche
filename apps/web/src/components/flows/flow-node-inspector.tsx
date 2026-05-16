'use client'

import { Plus, Trash } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AgentListItem } from '@/hooks/use-agents-catalog'
import { getFlowOutgoingTargets } from '@/lib/flows/graph'
import type { FlowConditionRule, FlowDefinition, FlowNode, SlackFlowNode } from '@/lib/flows/types'

type SlackTargetUser = {
  email: string
  id: string
  slackLinked: boolean
}

type SlackTargetChannel = {
  channelId: string
  isPrivate: boolean
  name: string
}

type FlowNodeInspectorProps = {
  agents: AgentListItem[]
  definition: FlowDefinition
  selectedNode: FlowNode | null
  slackChannels: SlackTargetChannel[]
  slackIntegrationEnabled: boolean
  slackUsers: SlackTargetUser[]
  onDeleteNode: (nodeId: string) => void
  onUpdateNode: (node: FlowNode) => void
}

type TemplateVariableSuggestion = {
  description: string
  label: string
  variable: string
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

function readSlackMessageMode(value: string): SlackFlowNode['messageMode'] {
  if (value === 'previous_output' || value === 'template') return value
  return 'fixed'
}

function appendTemplateVariable(value: string, variable: string): string {
  if (!value) return variable
  return `${value}${/\s$/.test(value) ? '' : ' '}${variable}`
}

function getAncestorNodes(definition: FlowDefinition, nodeId: string): FlowNode[] {
  const incomingByTarget = new Map<string, string[]>()
  for (const edge of definition.edges) {
    incomingByTarget.set(edge.targetNodeId, [
      ...(incomingByTarget.get(edge.targetNodeId) ?? []),
      edge.sourceNodeId,
    ])
  }

  const visited = new Set<string>()
  const queue = [...(incomingByTarget.get(nodeId) ?? [])]

  while (queue.length > 0) {
    const sourceNodeId = queue.shift()
    if (!sourceNodeId || visited.has(sourceNodeId)) continue

    visited.add(sourceNodeId)
    queue.push(...(incomingByTarget.get(sourceNodeId) ?? []))
  }

  return definition.nodes.filter((candidate) => visited.has(candidate.id))
}

function getTemplateVariableSuggestions(definition: FlowDefinition, node: FlowNode): TemplateVariableSuggestion[] {
  const ancestors = getAncestorNodes(definition, node.id)
  const suggestions: TemplateVariableSuggestion[] = [
    {
      description: 'The output handed to this step by the previous executed step.',
      label: 'Previous output',
      variable: 'previous.output',
    },
    {
      description: 'The current flow name.',
      label: 'Flow name',
      variable: 'flow.name',
    },
    {
      description: 'The current flow run id.',
      label: 'Run id',
      variable: 'run.id',
    },
  ]

  for (const ancestor of ancestors) {
    if (ancestor.type === 'human') {
      suggestions.push({
        description: `The response submitted for ${ancestor.name}.`,
        label: `${ancestor.name} response`,
        variable: `human.${ancestor.id}.response`,
      })
      continue
    }

    if (ancestor.type === 'merge') continue

    suggestions.push({
      description: `The recorded output from ${ancestor.name}.`,
      label: `${ancestor.name} output`,
      variable: `steps.${ancestor.id}.output`,
    })
  }

  return suggestions
}

function formatVariable(variable: string, mode: 'template' | 'raw'): string {
  return mode === 'template' ? `{{${variable}}}` : variable
}

function TemplateVariableHelp({
  mode,
  onInsert,
  suggestions,
}: {
  mode: 'template' | 'raw'
  onInsert: (value: string) => void
  suggestions: TemplateVariableSuggestion[]
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variables</p>
        <p className="text-xs text-muted-foreground">
          {mode === 'template'
            ? 'Click a chip to append it. Variables are replaced when the step runs.'
            : 'Click a chip to use it as the rule variable. Rule variables do not use curly braces.'}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const value = formatVariable(suggestion.variable, mode)
          return (
            <button
              key={suggestion.variable}
              type="button"
              title={suggestion.description}
              onClick={() => onInsert(value)}
              className="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
            >
              <span className="block text-[11px] font-medium text-foreground">{suggestion.label}</span>
              <code className="block text-[10px] text-muted-foreground">{value}</code>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HumanResponseReference({ node }: { node: Extract<FlowNode, { type: 'human' }> }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
      <p>
        After this step is answered, the next step receives the answer as <code className="text-foreground">{'{{previous.output}}'}</code>.
      </p>
      <p className="mt-1">
        Later steps can reference this exact response with <code className="text-foreground">{`{{human.${node.id}.response}}`}</code>.
      </p>
    </div>
  )
}

export function FlowNodeInspector({
  agents,
  definition,
  selectedNode,
  slackChannels,
  slackIntegrationEnabled,
  slackUsers,
  onDeleteNode,
  onUpdateNode,
}: FlowNodeInspectorProps) {
  if (!selectedNode) {
    return (
      <p className="text-sm text-muted-foreground">Select a node to edit its properties.</p>
    )
  }

  const node = selectedNode
  const targetOptions = node.type === 'condition'
    ? getFlowOutgoingTargets(definition, node.id)
      .map((targetNodeId) => definition.nodes.find((candidate) => candidate.id === targetNodeId))
      .filter((candidate): candidate is FlowNode => Boolean(candidate))
    : definition.nodes.filter((candidate) => candidate.id !== node.id)
  const templateSuggestions = getTemplateVariableSuggestions(definition, node)

  function updateRule(rule: FlowConditionRule) {
    if (node.type !== 'condition') return
    onUpdateNode({
      ...node,
      rules: (node.rules ?? []).map((candidate) => candidate.id === rule.id ? rule : candidate),
    })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="flow-node-name">Name</Label>
        <Input
          id="flow-node-name"
          value={node.name}
          onChange={(event) => onUpdateNode({ ...node, name: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Step ID: <code className="text-foreground">{node.id}</code>. Rename the step to update this ID and make variables readable.
        </p>
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
            <TemplateVariableHelp
              mode="template"
              suggestions={templateSuggestions}
              onInsert={(value) => onUpdateNode({ ...node, promptTemplate: appendTemplateVariable(node.promptTemplate, value) })}
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
            <TemplateVariableHelp
              mode="template"
              suggestions={templateSuggestions}
              onInsert={(value) => onUpdateNode({ ...node, instructions: appendTemplateVariable(node.instructions, value) })}
            />
          </div>
          <HumanResponseReference node={node} />
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
              {targetOptions.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Connect this condition to at least one target on the canvas before adding rules.
                </p>
              ) : null}
              {(node.rules ?? []).map((rule) => (
                <div key={rule.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <Input value={rule.variable} onChange={(event) => updateRule({ ...rule, variable: event.target.value })} placeholder="previous.output" />
                  <TemplateVariableHelp
                    mode="raw"
                    suggestions={templateSuggestions}
                    onInsert={(value) => updateRule({ ...rule, variable: value })}
                  />
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
                disabled={targetOptions.length === 0}
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
              <TemplateVariableHelp
                mode="template"
                suggestions={templateSuggestions}
                onInsert={(value) => onUpdateNode({
                  ...node,
                  evaluatorPrompt: appendTemplateVariable(node.evaluatorPrompt ?? '', value),
                })}
              />
            </div>
          )}
        </>
      ) : null}

      {node.type === 'slack' ? (
        <>
          {!slackIntegrationEnabled ? (
            <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Slack integration is not enabled. Configure Slack before this node can send messages.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="flow-slack-target-type">Target type</Label>
            <select
              id="flow-slack-target-type"
              value={node.target.type}
              onChange={(event) => onUpdateNode({
                ...node,
                target: event.target.value === 'channel'
                  ? { type: 'channel', channelId: slackChannels[0]?.channelId ?? '' }
                  : { type: 'dm', userId: slackUsers[0]?.id ?? '' },
              })}
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="dm">User DM</option>
              <option value="channel">Channel</option>
            </select>
          </div>

          {node.target.type === 'dm' ? (
            <div className="space-y-2">
              <Label htmlFor="flow-slack-dm-target">Slack DM target</Label>
              <select
                id="flow-slack-dm-target"
                value={node.target.userId}
                onChange={(event) => onUpdateNode({ ...node, target: { type: 'dm', userId: event.target.value } })}
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
              >
                <option value="">Select user...</option>
                {slackUsers.map((user) => (
                  <option key={user.id} value={user.id}>{user.email}{user.slackLinked ? ' (linked)' : ''}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="flow-slack-channel-target">Slack channel target</Label>
              {slackChannels.length > 0 ? (
                <select
                  id="flow-slack-channel-target"
                  value={node.target.channelId}
                  onChange={(event) => onUpdateNode({ ...node, target: { type: 'channel', channelId: event.target.value } })}
                  className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">Select channel...</option>
                  {slackChannels.map((channel) => (
                    <option key={channel.channelId} value={channel.channelId}>{channel.name}{channel.isPrivate ? ' (private)' : ''}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">No channels available. Configure notification channels in Slack settings.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="flow-slack-message-mode">Message source</Label>
            <select
              id="flow-slack-message-mode"
              value={node.messageMode}
              onChange={(event) => onUpdateNode({ ...node, messageMode: readSlackMessageMode(event.target.value) })}
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="fixed">Fixed text</option>
              <option value="previous_output">Previous step output</option>
              <option value="template">Template</option>
            </select>
          </div>

          {node.messageMode !== 'previous_output' ? (
            <div className="space-y-2">
              <Label htmlFor="flow-slack-message-template">Message</Label>
              <textarea
                id="flow-slack-message-template"
                value={node.messageTemplate}
                onChange={(event) => onUpdateNode({ ...node, messageTemplate: event.target.value })}
                rows={5}
                className="min-h-[120px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
              {node.messageMode === 'template' ? (
                <TemplateVariableHelp
                  mode="template"
                  suggestions={templateSuggestions}
                  onInsert={(value) => onUpdateNode({ ...node, messageTemplate: appendTemplateVariable(node.messageTemplate, value) })}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {node.type === 'compaction' ? (
        <div className="space-y-2">
          <Label htmlFor="flow-compaction-prompt">Compaction prompt</Label>
          <textarea
            id="flow-compaction-prompt"
            value={node.promptTemplate}
            onChange={(event) => onUpdateNode({ ...node, promptTemplate: event.target.value })}
            rows={5}
            className="min-h-[120px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          <TemplateVariableHelp
            mode="template"
            suggestions={templateSuggestions}
            onInsert={(value) => onUpdateNode({ ...node, promptTemplate: appendTemplateVariable(node.promptTemplate, value) })}
          />
        </div>
      ) : null}

      {node.type === 'merge' ? (
        <p className="text-xs text-muted-foreground">
          Merge nodes are pass-through join markers. Flows still execute one path at a time and continue through the selected next node.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-4">
        <p className="text-xs text-muted-foreground">
          Create or remove step connections directly on the canvas.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDeleteNode(node.id)}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash size={13} className="mr-1" /> Delete step
        </Button>
      </div>
    </div>
  )
}
