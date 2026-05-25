'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, SpinnerGap, UsersThree } from '@phosphor-icons/react'

import { FlowCanvas } from '@/components/flows/flow-canvas'
import { FlowNodeInspector } from '@/components/flows/flow-node-inspector'
import { FlowScheduleBuilder } from '@/components/flows/flow-schedule-builder'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { copyFlowRequest, createFlowRequest, deleteFlowRequest, fetchFlowDetail, runFlowRequest, updateFlowRequest } from '@/lib/flows/client'
import { getFlowTimeZoneOptions } from '@/lib/flows/cron'
import {
  addFlowDefinitionNodeAfter,
  connectFlowDefinitionNodes,
  deleteFlowDefinitionNode,
  moveFlowDefinitionNode,
  removeFlowDefinitionConnection,
  updateFlowDefinitionNode,
} from '@/lib/flows/editor-graph'
import {
  getDefaultFlowScheduleFormState,
  getFlowSchedulePreview,
  inferFlowScheduleFormState,
  type FlowScheduleFormState,
} from '@/lib/flows/schedule-form'
import type { FlowConnectorRequirementSummary, FlowDefinition, FlowDetail, FlowNode, FlowPermissions, FlowUserSummary, FlowVisibility } from '@/lib/flows/types'
import { createDefaultFlowDefinition, validateFlowDefinition } from '@/lib/flows/validation'
import { cn } from '@/lib/utils'

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

export function FlowEditor({ flowId, mode, slug }: FlowEditorProps) {
  const router = useRouter()
  const { agents } = useAgentsCatalog(slug)
  const timezoneOptions = useMemo(() => getFlowTimeZoneOptions(), [])
  const [definition, setDefinition] = useState<FlowDefinition>(() => createDefaultFlowDefinition())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('agent-1')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schedule, setSchedule] = useState<FlowScheduleFormState>(() => getDefaultFlowScheduleFormState())
  const [timezone, setTimezone] = useState('UTC')
  const [enabled, setEnabled] = useState(false)
  const [visibility, setVisibility] = useState<FlowVisibility>('private')
  const [organizationCanRun, setOrganizationCanRun] = useState(false)
  const [permissions, setPermissions] = useState<FlowPermissions | null>(null)
  const [owner, setOwner] = useState<FlowUserSummary | null>(null)
  const [missingConnectorRequirements, setMissingConnectorRequirements] = useState<FlowConnectorRequirementSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [slackIntegrationEnabled, setSlackIntegrationEnabled] = useState(false)
  const [teamMembers, setTeamMembers] = useState<SlackTargetUser[]>([])
  const [slackChannels, setSlackChannels] = useState<SlackTargetChannel[]>([])

  const isReadOnly = mode === 'edit' && permissions ? !permissions.canEdit : false

  const applyLoadedFlow = useCallback((flow: FlowDetail) => {
    setName(flow.name)
    setDescription(flow.description ?? '')
    setDefinition(flow.definition)
    setSelectedNodeId(flow.definition.startNodeId)
    setEditingNodeId(null)
    setSchedule(inferFlowScheduleFormState(flow.cronExpression))
    setTimezone(flow.timezone)
    setEnabled(flow.enabled)
    setVisibility(flow.visibility)
    setOrganizationCanRun(flow.visibility === 'team' ? flow.organizationCanRun : false)
    setPermissions(flow.permissions)
    setOwner(flow.owner)
    setMissingConnectorRequirements(flow.missingConnectorRequirements ?? [])
  }, [])

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

      applyLoadedFlow(result.data.flow)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [applyLoadedFlow, flowId, mode, slug])

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

        applyLoadedFlow(result.data.flow)
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
  }, [applyLoadedFlow, flowId, mode, slug])

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
    if (isReadOnly) return

    setDefinition(nextDefinition)
    if (selectedNodeId && !nextDefinition.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId((nextDefinition.startNodeId || nextDefinition.nodes[0]?.id) ?? null)
    }
    setEditingNodeId((current) => current && !nextDefinition.nodes.some((node) => node.id === current) ? null : current)
  }, [isReadOnly, selectedNodeId])

  const updateNode = useCallback((node: FlowNode) => {
    if (isReadOnly) return

    const result = updateFlowDefinitionNode(definition, node)
    if (!result) return

    updateDefinition(result.definition)
    if (result.nodeId !== node.id) {
      setSelectedNodeId(result.nodeId)
      setEditingNodeId(result.nodeId)
    }
  }, [definition, isReadOnly, updateDefinition])

  const deleteNode = useCallback((nodeId: string) => {
    if (isReadOnly) return

    const nextDefinition = deleteFlowDefinitionNode(definition, nodeId)
    if (!nextDefinition) return

    updateDefinition(nextDefinition)
    setEditingNodeId((current) => current === nodeId ? null : current)
  }, [definition, isReadOnly, updateDefinition])

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    if (isReadOnly) return

    setDefinition((current) => moveFlowDefinitionNode(current, nodeId, x, y))
  }, [isReadOnly])

  const addNodeAfter = useCallback((sourceNodeId: string, type: FlowNode['type']) => {
    if (isReadOnly) return

    const result = addFlowDefinitionNodeAfter(definition, sourceNodeId, type)
    if (!result) return

    updateDefinition(result.definition)
    setSelectedNodeId(result.node.id)
    setEditingNodeId(result.node.id)
  }, [definition, isReadOnly, updateDefinition])

  const connectNodes = useCallback((sourceNodeId: string, targetNodeId: string) => {
    if (isReadOnly) return

    const nextDefinition = connectFlowDefinitionNodes(definition, sourceNodeId, targetNodeId)
    if (!nextDefinition) return

    updateDefinition(nextDefinition)
    setSelectedNodeId(targetNodeId)
  }, [definition, isReadOnly, updateDefinition])

  const removeConnection = useCallback((edgeId: string) => {
    if (isReadOnly) return

    updateDefinition(removeFlowDefinitionConnection(definition, edgeId))
  }, [definition, isReadOnly, updateDefinition])

  const saveFlow = useCallback(async () => {
    if (isReadOnly) return

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
        organizationCanRun: visibility === 'team' ? organizationCanRun : false,
        timezone,
        visibility,
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
  }, [definition, description, enabled, flowId, isReadOnly, loadFlow, mode, name, organizationCanRun, router, schedulePreview, slug, timezone, visibility])

  const deleteFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId || !permissions?.canManage) return

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
  }, [flowId, mode, permissions?.canManage, router, slug])

  const runFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId || !permissions?.canRun) return
    if (missingConnectorRequirements.length > 0) {
      setFormError('missing_connectors')
      return
    }

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
  }, [flowId, loadFlow, missingConnectorRequirements.length, mode, permissions?.canRun, slug])

  const copyFlow = useCallback(async () => {
    if (mode !== 'edit' || !flowId || !permissions?.canCopy) return

    setIsCopying(true)
    setFormError(null)
    try {
      const result = await copyFlowRequest(slug, flowId)
      if (!result.ok) {
        setFormError(result.error)
        return
      }

      router.push(`/u/${slug}/flows/${result.data.flow.id}`)
    } catch {
      setFormError('network_error')
    } finally {
      setIsCopying(false)
    }
  }, [flowId, mode, permissions?.canCopy, router, slug])

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
        <section className="rounded-xl border border-border/60 bg-card/40 px-5 pb-5 pt-4">
          {isReadOnly ? (
            <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              This team flow is read-only. It runs in your workspace when execution is enabled by the owner.
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="flow-name">Flow name</Label>
              <Input id="flow-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly GTM review" disabled={isReadOnly} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="flow-description">Description</Label>
              <Input id="flow-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this flow automates" disabled={isReadOnly} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sharing</h2>
              <p className="text-xs text-muted-foreground">
                {isReadOnly && owner ? `Shared by ${owner.slug}. Copy it to create your own editable version.` : 'Choose whether teammates can view or run this flow.'}
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Flow visibility"
              className={cn(
                'inline-flex h-9 items-center rounded-lg border border-border/70 bg-background/60 p-0.5 text-sm',
                isReadOnly && 'pointer-events-none opacity-60',
              )}
            >
              {[
                { value: 'private' as const, label: 'Private', icon: Lock },
                { value: 'team' as const, label: 'Team', icon: UsersThree },
              ].map(({ value, label, icon: Icon }) => {
                const active = visibility === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={isReadOnly}
                    onClick={() => {
                      setVisibility(value)
                      if (value === 'private') setOrganizationCanRun(false)
                    }}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon size={14} weight={active ? 'fill' : 'regular'} />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div
            aria-hidden={visibility !== 'team'}
            className={cn(
              'grid transition-[grid-template-rows,margin-top,opacity] duration-300 ease-out',
              visibility === 'team' ? 'mt-4 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Team can run</p>
                  <p className="text-xs text-muted-foreground">Runs use each teammate&apos;s workspace and connectors.</p>
                </div>
                <Switch
                  checked={visibility === 'team' && organizationCanRun}
                  disabled={isReadOnly || visibility !== 'team'}
                  onCheckedChange={setOrganizationCanRun}
                  aria-label="Allow team to run flow"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Schedule</h2>
              <p className="text-xs text-muted-foreground">Run this flow automatically on a recurring schedule. Enabled flows also run once after creation.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable scheduled flow" disabled={isReadOnly} />
          </div>
          <div
            aria-hidden={!enabled}
            className={cn(
              'grid transition-[grid-template-rows,margin-top,opacity] duration-300 ease-out',
              enabled ? 'mt-5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div className={cn(isReadOnly && 'pointer-events-none opacity-60')}>
                <FlowScheduleBuilder
                  preview={schedulePreview}
                  schedule={schedule}
                  timezone={timezone}
                  timezoneOptions={timezoneOptions}
                  onChange={setSchedule}
                  onTimezoneChange={setTimezone}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Flow canvas</h2>
            <p className="text-xs text-muted-foreground">
              {isReadOnly ? 'Review the flow graph. Copy the flow to make editable changes.' : 'Hover a step to edit it, drag from its connector dot, or use + to add the next step.'}
            </p>
          </div>
          <FlowCanvas
            definition={definition}
            readOnly={isReadOnly}
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

      {mode === 'edit' && permissions?.canManage ? (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
              <p className="text-xs text-muted-foreground">
                Deleting a flow hides it from the list and cancels scheduled, retrying, and active runs. Existing run history remains available from linked sessions.
              </p>
            </div>
            <Button variant="destructive" onClick={() => void deleteFlow()} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete flow'}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-6 border-t border-border/60 bg-background/85 px-6 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        {(!validation.ok || !isScheduleValid || formError) ? (
          <div className="mb-3 space-y-1">
            {!validation.ok ? <p className="text-sm text-destructive">Definition error: {validation.error}</p> : null}
            {!isScheduleValid ? <p className="text-sm text-destructive">Schedule error: invalid_cron_expression</p> : null}
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
        ) : null}
        {missingConnectorRequirements.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Missing connectors: {missingConnectorRequirements.map((requirement) => requirement.connectorType).join(', ')}. Configure them before running this flow.
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" asChild><Link href={`/u/${slug}/flows`}>Back to list</Link></Button>
          {mode === 'edit' && permissions?.canCopy ? (
            <Button variant="outline" onClick={() => void copyFlow()} disabled={isCopying}>
              {isCopying ? 'Copying...' : 'Copy flow'}
            </Button>
          ) : null}
          {mode === 'edit' && permissions?.canRun ? (
            <Button variant="outline" onClick={() => void runFlow()} disabled={isRunning || missingConnectorRequirements.length > 0}>
              {isRunning ? 'Starting...' : 'Run flow'}
            </Button>
          ) : null}
          {!isReadOnly ? (
            <Button onClick={() => void saveFlow()} disabled={isSaving || !validation.ok || !isScheduleValid}>
              {isSaving ? 'Saving...' : mode === 'create' ? 'Create flow' : 'Save changes'}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={Boolean(editingNode) && !isReadOnly} onOpenChange={(open) => {
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
    </div>
  )
}
