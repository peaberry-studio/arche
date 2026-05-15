'use client'

import { Plus, Trash } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AgentListItem } from '@/hooks/use-agents-catalog'
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
  const targetOptions = definition.nodes.filter((candidate) => candidate.id !== node.id)

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
            </div>
          ) : null}
        </>
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
