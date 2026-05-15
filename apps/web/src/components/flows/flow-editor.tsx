'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SpinnerGap } from '@phosphor-icons/react'

import { FlowCanvas } from '@/components/flows/flow-canvas'
import { FlowNodeInspector } from '@/components/flows/flow-node-inspector'
import { FlowRunHistory } from '@/components/flows/flow-run-history'
import { FlowScheduleBuilder } from '@/components/flows/flow-schedule-builder'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { createFlowRequest, deleteFlowRequest, fetchFlowDetail, runFlowRequest, updateFlowRequest } from '@/lib/flows/client'
import { getFlowTimeZoneOptions } from '@/lib/flows/cron'
import {
  getDefaultFlowScheduleFormState,
  getFlowSchedulePreview,
  inferFlowScheduleFormState,
  type FlowScheduleFormState,
} from '@/lib/flows/schedule-form'
import type { FlowDefinition, FlowDetail, FlowNode } from '@/lib/flows/types'
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

  if (type === 'slack') {
    return {
      id,
      messageMode: 'fixed',
      messageTemplate: 'Flow update',
      name: `Slack message ${index}`,
      target: { type: 'dm', userId: '' },
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
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schedule, setSchedule] = useState<FlowScheduleFormState>(() => getDefaultFlowScheduleFormState())
  const [timezone, setTimezone] = useState('UTC')
  const [enabled, setEnabled] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [slackIntegrationEnabled, setSlackIntegrationEnabled] = useState(false)
  const [teamMembers, setTeamMembers] = useState<SlackTargetUser[]>([])
  const [slackChannels, setSlackChannels] = useState<SlackTargetChannel[]>([])

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
      setEditingNodeId(null)
      setSchedule(inferFlowScheduleFormState(result.data.flow.cronExpression))
      setTimezone(result.data.flow.timezone)
      setEnabled(result.data.flow.enabled)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [flowId, mode, slug])

  useEffect(() => {
    if (mode !== 'edit' || !flowId) return

    const currentFlowId = flowId
    let cancelled = false

    async function loadInitialFlow() {
      try {
        const result = await fetchFlowDetail(slug, currentFlowId)
        if (cancelled) return

        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        setFlow(result.data.flow)
        setName(result.data.flow.name)
        setDescription(result.data.flow.description ?? '')
        setDefinition(result.data.flow.definition)
        setSelectedNodeId(result.data.flow.definition.startNodeId)
        setEditingNodeId(null)
        setSchedule(inferFlowScheduleFormState(result.data.flow.cronExpression))
        setTimezone(result.data.flow.timezone)
        setEnabled(result.data.flow.enabled)
      } catch {
        if (!cancelled) {
          setLoadError('network_error')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialFlow()

    return () => {
      cancelled = true
    }
  }, [flowId, mode, slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialSlackTargets() {
      try {
        const response = await fetch(`/api/u/${slug}/flows/slack-targets`, { cache: 'no-store' })
        const data = (await response.json().catch(() => null)) as
          | {
              channels?: SlackTargetChannel[]
              integrationEnabled?: boolean
              users?: SlackTargetUser[]
            }
          | null
        if (cancelled) return

        if (!response.ok || !data) {
          setSlackIntegrationEnabled(false)
          return
        }

        setSlackIntegrationEnabled(data.integrationEnabled === true)
        setTeamMembers(data.users ?? [])
        setSlackChannels(data.channels ?? [])
      } catch (error) {
        console.error('[flow-editor] Failed to load Slack targets', error)
        if (!cancelled) {
          setSlackIntegrationEnabled(false)
        }
      }
    }

    void loadInitialSlackTargets()

    return () => {
      cancelled = true
    }
  }, [slug])

  const editingNode = useMemo(
    () => definition.nodes.find((node) => node.id === editingNodeId) ?? null,
    [definition.nodes, editingNodeId],
  )
  const validation = useMemo(() => validateFlowDefinition(definition), [definition])
  const schedulePreview = useMemo(() => getFlowSchedulePreview(schedule, timezone), [schedule, timezone])
  const isScheduleValid = !enabled || schedulePreview.isValid

  const updateDefinition = useCallback((nextDefinition: FlowDefinition) => {
    setDefinition(nextDefinition)
    if (selectedNodeId && !nextDefinition.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId((nextDefinition.startNodeId || nextDefinition.nodes[0]?.id) ?? null)
    }
    setEditingNodeId((current) => current && !nextDefinition.nodes.some((node) => node.id === current) ? null : current)
  }, [selectedNodeId])

  const updateNode = useCallback((node: FlowNode) => {
    updateDefinition({
      ...definition,
      nodes: definition.nodes.map((candidate) => candidate.id === node.id ? node : candidate),
    })
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
    setEditingNodeId((current) => current === nodeId ? null : current)
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

  const addNodeAfter = useCallback((sourceNodeId: string, type: FlowNode['type']) => {
    const sourceNode = definition.nodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return

    const sourceIndex = definition.nodes.findIndex((node) => node.id === sourceNodeId)
    const sourceLayout = definition.layout?.nodes.find((node) => node.nodeId === sourceNodeId)
    const node = createNode(type, definition.nodes.length + 1)
    const edgeBase = Date.now()
    const existingOutgoing = definition.edges.filter((edge) => edge.sourceNodeId === sourceNodeId)
    const retainedEdges = sourceNode.type === 'condition'
      ? definition.edges
      : definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId)
    const insertedEdges = [
      ...retainedEdges,
      { id: `edge-${edgeBase}`, sourceNodeId, targetNodeId: node.id },
    ]
    const bridgedEdges = sourceNode.type !== 'condition' && existingOutgoing[0]
      ? [
          ...insertedEdges,
          { id: `edge-${edgeBase}-next`, sourceNodeId: node.id, targetNodeId: existingOutgoing[0].targetNodeId },
        ]
      : insertedEdges

    updateDefinition({
      ...definition,
      edges: bridgedEdges,
      layout: {
        nodes: [
          ...(definition.layout?.nodes ?? []),
          {
            nodeId: node.id,
            x: (sourceLayout?.x ?? 120 + sourceIndex * 190) + 230,
            y: sourceLayout?.y ?? 120,
          },
        ],
      },
      nodes: [...definition.nodes, node],
    })
    setSelectedNodeId(node.id)
    setEditingNodeId(node.id)
  }, [definition, updateDefinition])

  const connectNodes = useCallback((sourceNodeId: string, targetNodeId: string) => {
    if (sourceNodeId === targetNodeId) return

    const sourceNode = definition.nodes.find((node) => node.id === sourceNodeId)
    const targetNode = definition.nodes.find((node) => node.id === targetNodeId)
    if (!sourceNode || !targetNode) return

    const retainedEdges = sourceNode.type === 'condition'
      ? definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId || edge.targetNodeId !== targetNodeId)
      : definition.edges.filter((edge) => edge.sourceNodeId !== sourceNodeId)

    updateDefinition({
      ...definition,
      edges: [
        ...retainedEdges,
        { id: `edge-${Date.now()}`, sourceNodeId, targetNodeId },
      ],
    })
    setSelectedNodeId(targetNodeId)
  }, [definition, updateDefinition])

  const removeConnection = useCallback((edgeId: string) => {
    updateDefinition({ ...definition, edges: definition.edges.filter((edge) => edge.id !== edgeId) })
  }, [definition, updateDefinition])

  const saveFlow = useCallback(async () => {
    setIsSaving(true)
    setFormError(null)

    if (enabled && !schedulePreview.isValid) {
      setFormError('invalid_cron_expression')
      setIsSaving(false)
      return
    }

    try {
      const payloadCronExpression = schedulePreview.isValid ? schedulePreview.cronExpression : null
      const payload = {
        cronExpression: enabled ? schedulePreview.cronExpression : payloadCronExpression,
        definition,
        description: description.trim() ? description : null,
        enabled,
        name,
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
  }, [definition, description, enabled, flowId, loadFlow, mode, name, router, schedulePreview, slug, timezone])

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
      <div className="space-y-6">
        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
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
              <Label htmlFor="flow-timezone">Timezone</Label>
              <Input id="flow-timezone" list="flow-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
              <datalist id="flow-timezones">
                {timezoneOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Schedule</h2>
              <p className="text-xs text-muted-foreground">Run this flow automatically on a recurring schedule. Enabled flows also run once after creation.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable scheduled flow" />
          </div>
          <FlowScheduleBuilder
            preview={schedulePreview}
            schedule={schedule}
            timezone={timezone}
            onChange={setSchedule}
          />
        </section>

        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Flow canvas</h2>
            <p className="text-xs text-muted-foreground">Hover a step to edit it, drag from its connector dot, or use + to add the next step.</p>
          </div>
          <FlowCanvas
            definition={definition}
            selectedNodeId={selectedNodeId}
            onAddNodeAfter={addNodeAfter}
            onConnectNodes={connectNodes}
            onEditNode={(nodeId) => {
              setSelectedNodeId(nodeId)
              setEditingNodeId(nodeId)
            }}
            onMoveNode={moveNode}
            onRemoveConnection={removeConnection}
            onSelectNode={setSelectedNodeId}
          />
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveFlow()} disabled={isSaving || !validation.ok || !isScheduleValid}>
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
      {!isScheduleValid ? <p className="text-sm text-destructive">Schedule error: invalid_cron_expression</p> : null}
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <Dialog open={Boolean(editingNode)} onOpenChange={(open) => {
        if (!open) setEditingNodeId(null)
      }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit step</DialogTitle>
            <DialogDescription>Update the selected flow step. Connections are managed on the canvas.</DialogDescription>
          </DialogHeader>
          <FlowNodeInspector
            agents={agents}
            definition={definition}
            selectedNode={editingNode}
            slackChannels={slackChannels}
            slackIntegrationEnabled={slackIntegrationEnabled}
            slackUsers={teamMembers}
            onDeleteNode={deleteNode}
            onUpdateNode={updateNode}
          />
        </DialogContent>
      </Dialog>

      {mode === 'edit' && flow ? <FlowRunHistory flow={flow} slug={slug} onRefresh={loadFlow} /> : null}
    </div>
  )
}
