'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GitBranch, Plus, SpinnerGap, Trash } from '@phosphor-icons/react'

import { FlowCanvas } from '@/components/flows/flow-canvas'
import { FlowNodeInspector } from '@/components/flows/flow-node-inspector'
import { FlowRunHistory } from '@/components/flows/flow-run-history'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { createFlowRequest, deleteFlowRequest, fetchFlowDetail, runFlowRequest, updateFlowRequest } from '@/lib/flows/client'
import { getFlowTimeZoneOptions } from '@/lib/flows/cron'
import type { FlowDefinition, FlowDetail, FlowNode, FlowSlackNotificationTarget } from '@/lib/flows/types'
import { createDefaultFlowDefinition, validateFlowDefinition } from '@/lib/flows/validation'

type FlowEditorProps = {
  flowId?: string
  mode: 'create' | 'edit'
  slug: string
}

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

function createNode(type: FlowNode['type'], index: number): FlowNode {
  const id = `${type}-${Date.now()}`
  if (type === 'agent') {
    return {
      compactOutput: false,
      id,
      name: `Agent step ${index}`,
      promptTemplate: 'Use {{previous.output}} if this is not the first step.',
      targetAgentId: null,
      type,
    }
  }

  if (type === 'human') {
    return {
      id,
      instructions: 'Review the current flow output and provide the next instruction.',
      name: `Human step ${index}`,
      required: true,
      type,
    }
  }

  if (type === 'condition') {
    return {
      id,
      mode: 'rules',
      name: `Condition ${index}`,
      rules: [],
      type,
    }
  }

  if (type === 'compaction') {
    return {
      id,
      name: `Compaction ${index}`,
      promptTemplate: 'Compact {{previous.output}} for later steps.',
      type,
    }
  }

  return {
    id,
    name: `Merge ${index}`,
    type,
  }
}

export function FlowEditor({ flowId, mode, slug }: FlowEditorProps) {
  const router = useRouter()
  const { agents } = useAgentsCatalog(slug)
  const timezoneOptions = useMemo(() => getFlowTimeZoneOptions(), [])
  const [flow, setFlow] = useState<FlowDetail | null>(null)
  const [definition, setDefinition] = useState<FlowDefinition>(() => createDefaultFlowDefinition())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('agent-1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cronExpression, setCronExpression] = useState('')
  const [timezone, setTimezone] = useState('UTC')
  const [enabled, setEnabled] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [connectionSource, setConnectionSource] = useState('')
  const [connectionTarget, setConnectionTarget] = useState('')
  const [slackIntegrationEnabled, setSlackIntegrationEnabled] = useState(false)
  const [slackNotificationsEnabled, setSlackNotificationsEnabled] = useState(false)
  const [includeSessionLink, setIncludeSessionLink] = useState(true)
  const [targetType, setTargetType] = useState<'dm' | 'channel'>('dm')
  const [selectedDmUser, setSelectedDmUser] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('')
  const [notificationTargets, setNotificationTargets] = useState<FlowSlackNotificationTarget[]>([])
  const [teamMembers, setTeamMembers] = useState<SlackTargetUser[]>([])
  const [slackChannels, setSlackChannels] = useState<SlackTargetChannel[]>([])
  const [slackNotificationError, setSlackNotificationError] = useState<string | null>(null)

  const loadFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId) return

    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await fetchFlowDetail(slug, flowId)
      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      setFlow(result.data.flow)
      setName(result.data.flow.name)
      setDescription(result.data.flow.description ?? '')
      setDefinition(result.data.flow.definition)
      setSelectedNodeId(result.data.flow.definition.startNodeId)
      setCronExpression(result.data.flow.cronExpression ?? '')
      setTimezone(result.data.flow.timezone)
      setEnabled(result.data.flow.enabled)
      if (result.data.flow.slackNotificationConfig) {
        setSlackNotificationsEnabled(result.data.flow.slackNotificationConfig.enabled)
        setIncludeSessionLink(result.data.flow.slackNotificationConfig.includeSessionLink)
        setNotificationTargets(result.data.flow.slackNotificationConfig.targets)
      } else {
        setSlackNotificationsEnabled(false)
        setIncludeSessionLink(true)
        setNotificationTargets([])
      }
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [flowId, mode, slug])

  useEffect(() => {
    void loadFlow()
  }, [loadFlow])

  const loadSlackTargets = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/flows/slack-targets`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | {
            channels?: SlackTargetChannel[]
            integrationEnabled?: boolean
            users?: SlackTargetUser[]
          }
        | null
      if (!response.ok || !data) {
        setSlackIntegrationEnabled(false)
        return
      }

      setSlackIntegrationEnabled(data.integrationEnabled === true)
      setTeamMembers(data.users ?? [])
      setSlackChannels(data.channels ?? [])
    } catch (error) {
      console.error('[flow-editor] Failed to load Slack targets', error)
      setSlackIntegrationEnabled(false)
    }
  }, [slug])

  useEffect(() => {
    void loadSlackTargets()
  }, [loadSlackTargets])

  const selectedNode = useMemo(
    () => definition.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [definition.nodes, selectedNodeId],
  )
  const validation = useMemo(() => validateFlowDefinition(definition), [definition])
  const canAddTarget = useMemo(() => {
    if (targetType === 'dm') {
      return selectedDmUser.length > 0 && !notificationTargets.some((target) => target.type === 'dm' && target.userId === selectedDmUser)
    }

    return selectedChannel.length > 0 && !notificationTargets.some((target) => target.type === 'channel' && target.channelId === selectedChannel)
  }, [notificationTargets, selectedChannel, selectedDmUser, targetType])

  const getTargetLabel = useCallback((target: FlowSlackNotificationTarget): string => {
    if (target.type === 'dm') {
      const member = teamMembers.find((item) => item.id === target.userId)
      return `DM: ${member?.email ?? target.userId}`
    }

    const channel = slackChannels.find((item) => item.channelId === target.channelId)
    return `Channel: ${channel?.name ?? target.channelId}`
  }, [slackChannels, teamMembers])

  const addNotificationTarget = useCallback(() => {
    if (!canAddTarget) return

    if (targetType === 'dm') {
      setNotificationTargets((current) => [...current, { type: 'dm', userId: selectedDmUser }])
      setSelectedDmUser('')
      return
    }

    setNotificationTargets((current) => [...current, { type: 'channel', channelId: selectedChannel }])
    setSelectedChannel('')
  }, [canAddTarget, selectedChannel, selectedDmUser, targetType])

  const removeNotificationTarget = useCallback((index: number) => {
    setNotificationTargets((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }, [])

  const updateDefinition = useCallback((nextDefinition: FlowDefinition) => {
    setDefinition(nextDefinition)
    if (selectedNodeId && !nextDefinition.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId((nextDefinition.startNodeId || nextDefinition.nodes[0]?.id) ?? null)
    }
  }, [selectedNodeId])

  const updateNode = useCallback((node: FlowNode) => {
    updateDefinition({
      ...definition,
      nodes: definition.nodes.map((candidate) => candidate.id === node.id ? node : candidate),
    })
  }, [definition, updateDefinition])

  const addNode = useCallback((type: FlowNode['type']) => {
    const node = createNode(type, definition.nodes.length + 1)
    updateDefinition({
      ...definition,
      layout: {
        nodes: [
          ...(definition.layout?.nodes ?? []),
          { nodeId: node.id, x: 120 + definition.nodes.length * 40, y: 180 + definition.nodes.length * 28 },
        ],
      },
      nodes: [...definition.nodes, node],
    })
    setSelectedNodeId(node.id)
  }, [definition, updateDefinition])

  const deleteNode = useCallback((nodeId: string) => {
    const nextNodes = definition.nodes.filter((node) => node.id !== nodeId)
    if (nextNodes.length === 0) return

    const nextStartNodeId = definition.startNodeId === nodeId ? nextNodes[0].id : definition.startNodeId
    updateDefinition({
      ...definition,
      edges: definition.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
      layout: {
        nodes: (definition.layout?.nodes ?? []).filter((node) => node.nodeId !== nodeId),
      },
      nodes: nextNodes,
      startNodeId: nextStartNodeId,
    })
  }, [definition, updateDefinition])

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setDefinition((current) => {
      const layoutNodes = current.layout?.nodes ?? []
      const exists = layoutNodes.some((node) => node.nodeId === nodeId)
      return {
        ...current,
        layout: {
          nodes: exists
            ? layoutNodes.map((node) => node.nodeId === nodeId ? { ...node, x, y } : node)
            : [...layoutNodes, { nodeId, x, y }],
        },
      }
    })
  }, [])

  const addConnection = useCallback(() => {
    if (!connectionSource || !connectionTarget || connectionSource === connectionTarget) return
    updateDefinition({
      ...definition,
      edges: [
        ...definition.edges.filter((edge) => edge.sourceNodeId !== connectionSource || edge.targetNodeId !== connectionTarget),
        { id: `edge-${Date.now()}`, sourceNodeId: connectionSource, targetNodeId: connectionTarget },
      ],
    })
  }, [connectionSource, connectionTarget, definition, updateDefinition])

  const removeConnection = useCallback((edgeId: string) => {
    updateDefinition({ ...definition, edges: definition.edges.filter((edge) => edge.id !== edgeId) })
  }, [definition, updateDefinition])

  const saveFlow = useCallback(async () => {
    setIsSaving(true)
    setFormError(null)
    setSlackNotificationError(null)

    if (slackNotificationsEnabled && notificationTargets.length === 0) {
      setSlackNotificationError('Add at least one Slack notification target.')
      setIsSaving(false)
      return
    }

    try {
      const slackNotificationConfig = slackNotificationsEnabled
        ? {
            enabled: true,
            includeSessionLink,
            targets: notificationTargets,
          }
        : mode === 'edit' && flow?.slackNotificationConfig
          ? null
          : undefined
      const payload = {
        cronExpression: cronExpression.trim() ? cronExpression : null,
        definition,
        description: description.trim() ? description : null,
        enabled,
        name,
        slackNotificationConfig,
        timezone,
      }
      const result = mode === 'create'
        ? await createFlowRequest(slug, payload)
        : flowId
          ? await updateFlowRequest(slug, flowId, payload)
          : { ok: false as const, error: 'missing_flow_id' }
      if (!result.ok) {
        setFormError(result.error)
        return
      }

      setFlow(result.data.flow)
      if (mode === 'create') {
        router.push(`/u/${slug}/flows/${result.data.flow.id}`)
        return
      }

      await loadFlow()
    } catch {
      setFormError('network_error')
    } finally {
      setIsSaving(false)
    }
  }, [cronExpression, definition, description, enabled, flow, flowId, includeSessionLink, loadFlow, mode, name, notificationTargets, router, slackNotificationsEnabled, slug, timezone])

  const deleteFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId) return

    setIsDeleting(true)
    setFormError(null)
    try {
      const result = await deleteFlowRequest(slug, flowId)
      if (!result.ok) {
        setFormError(result.error)
        return
      }

      router.push(`/u/${slug}/flows`)
    } catch {
      setFormError('network_error')
    } finally {
      setIsDeleting(false)
    }
  }, [flowId, mode, router, slug])

  const runFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId) return

    setIsRunning(true)
    setFormError(null)
    try {
      const result = await runFlowRequest(slug, flowId)
      if (!result.ok) {
        setFormError(result.error)
        return
      }

      await loadFlow()
    } catch {
      setFormError('network_error')
    } finally {
      setIsRunning(false)
    }
  }, [flowId, loadFlow, mode, slug])

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          Loading flow...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load flow</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void loadFlow()}>Retry</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="flow-name">Flow name</Label>
              <Input id="flow-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly GTM review" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="flow-description">Description</Label>
              <Input id="flow-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this flow automates" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flow-cron">Cron schedule</Label>
              <Input id="flow-cron" value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} placeholder="0 9 * * 1" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flow-timezone">Timezone</Label>
              <Input id="flow-timezone" list="flow-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
              <datalist id="flow-timezones">
                {timezoneOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Scheduled</p>
              <p className="text-xs text-muted-foreground">Enabled flows run on the cron schedule and once after creation.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable scheduled flow" />
          </div>

          {slackIntegrationEnabled ? (
            <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="flow-slack-notifications">Slack notifications</Label>
                  <p className="text-xs text-muted-foreground">Send flow results to Slack DMs or allowlisted channels.</p>
                </div>
                <Switch
                  checked={slackNotificationsEnabled}
                  id="flow-slack-notifications"
                  onCheckedChange={setSlackNotificationsEnabled}
                />
              </div>

              {slackNotificationsEnabled ? (
                <div className="space-y-4 border-t border-border/40 pt-3">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="flow-include-session-link">Include session link</Label>
                    <Switch
                      checked={includeSessionLink}
                      id="flow-include-session-link"
                      onCheckedChange={setIncludeSessionLink}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Notification targets</Label>
                    <div className="space-y-2">
                      <label htmlFor="flow-target-dm" className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          checked={targetType === 'dm'}
                          id="flow-target-dm"
                          name="flow-target-type"
                          onChange={() => setTargetType('dm')}
                          type="radio"
                          value="dm"
                        />
                        Send to user DM
                      </label>

                      {targetType === 'dm' ? (
                        <div className="ml-6">
                          <select
                            aria-label="Slack DM target"
                            className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
                            onChange={(event) => setSelectedDmUser(event.target.value)}
                            value={selectedDmUser}
                          >
                            <option value="">Select user...</option>
                            {teamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.email}{member.slackLinked ? ' (linked)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}

                      <label htmlFor="flow-target-channel" className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          checked={targetType === 'channel'}
                          id="flow-target-channel"
                          name="flow-target-type"
                          onChange={() => setTargetType('channel')}
                          type="radio"
                          value="channel"
                        />
                        Send to channel
                      </label>

                      {targetType === 'channel' ? (
                        slackChannels.length > 0 ? (
                          <div className="ml-6">
                            <select
                              aria-label="Slack channel target"
                              className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
                              onChange={(event) => setSelectedChannel(event.target.value)}
                              value={selectedChannel}
                            >
                              <option value="">Select channel...</option>
                              {slackChannels.map((channel) => (
                                <option key={channel.channelId} value={channel.channelId}>
                                  {channel.name}{channel.isPrivate ? ' (private)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <p className="ml-6 text-xs text-muted-foreground">No channels available. Configure notification channels in Slack settings.</p>
                        )
                      ) : null}
                    </div>

                    <Button type="button" variant="outline" size="sm" onClick={() => addNotificationTarget()} disabled={!canAddTarget}>Add target</Button>

                    {notificationTargets.length > 0 ? (
                      <div className="space-y-1 pt-1">
                        <p className="text-xs font-medium text-muted-foreground">Active targets ({notificationTargets.length})</p>
                        {notificationTargets.map((target, index) => (
                          <div key={`${target.type}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                            <span>{getTargetLabel(target)}</span>
                            <button type="button" onClick={() => removeNotificationTarget(index)} className="text-muted-foreground hover:text-destructive">Remove</button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {slackNotificationError ? <p className="text-sm text-destructive">{slackNotificationError}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => addNode('agent')}><Plus size={13} className="mr-1" />Agent</Button>
            <Button type="button" variant="outline" onClick={() => addNode('human')}><Plus size={13} className="mr-1" />Human</Button>
            <Button type="button" variant="outline" onClick={() => addNode('condition')}><Plus size={13} className="mr-1" />Condition</Button>
            <Button type="button" variant="outline" onClick={() => addNode('merge')}><Plus size={13} className="mr-1" />Merge</Button>
          </div>

          <FlowCanvas
            definition={definition}
            selectedNodeId={selectedNodeId}
            onMoveNode={moveNode}
            onSelectNode={setSelectedNodeId}
          />
        </div>

        <div className="space-y-4">
          <FlowNodeInspector
            agents={agents}
            definition={definition}
            selectedNode={selectedNode}
            onDeleteNode={deleteNode}
            onUpdateDefinition={updateDefinition}
            onUpdateNode={updateNode}
          />

          <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
            <div className="flex items-center gap-2">
              <GitBranch size={15} weight="bold" />
              <h3 className="text-sm font-semibold">Connections</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={connectionSource} onChange={(event) => setConnectionSource(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
                <option value="">Source</option>
                {definition.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
              <select value={connectionTarget} onChange={(event) => setConnectionTarget(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
                <option value="">Target</option>
                {definition.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addConnection}>Add connection</Button>
            <div className="space-y-2">
              {definition.edges.map((edge) => {
                const source = definition.nodes.find((node) => node.id === edge.sourceNodeId)
                const target = definition.nodes.find((node) => node.id === edge.targetNodeId)
                return (
                  <div key={edge.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs">
                    <span className="truncate">{source?.name ?? edge.sourceNodeId}{' -> '}{target?.name ?? edge.targetNodeId}</span>
                    <button type="button" onClick={() => removeConnection(edge.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove connection">
                      <Trash size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveFlow()} disabled={isSaving || !validation.ok}>
            {isSaving ? 'Saving...' : mode === 'create' ? 'Create flow' : 'Save changes'}
          </Button>
          {mode === 'edit' ? (
            <Button variant="outline" onClick={() => void runFlow()} disabled={isRunning}>
              {isRunning ? 'Starting...' : 'Run flow'}
            </Button>
          ) : null}
          <Button variant="outline" asChild><Link href={`/u/${slug}/flows`}>Back to list</Link></Button>
        </div>
        {mode === 'edit' ? (
          <button type="button" onClick={() => void deleteFlow()} disabled={isDeleting} className="text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50">
            {isDeleting ? 'Deleting...' : 'Delete flow'}
          </button>
        ) : null}
      </div>

      {!validation.ok ? <p className="text-sm text-destructive">Definition error: {validation.error}</p> : null}
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      {mode === 'edit' && flow ? <FlowRunHistory flow={flow} slug={slug} onRefresh={loadFlow} /> : null}
    </div>
  )
}
