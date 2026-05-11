'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SpinnerGap } from '@phosphor-icons/react'

import { AutopilotRunHistory } from '@/components/autopilot/autopilot-run-history'
import { AutopilotScheduleBuilder } from '@/components/autopilot/autopilot-schedule-builder'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import {
  getAutopilotTimeZoneOptions,
} from '@/lib/autopilot/cron'
import {
  getAutopilotSchedulePreview,
  getDefaultAutopilotScheduleFormState,
  inferAutopilotScheduleFormState,
  type AutopilotScheduleFormState,
} from '@/lib/autopilot/schedule-form'
import type { AutopilotSlackNotificationTarget, AutopilotTaskDetail } from '@/lib/autopilot/types'

type AutopilotTaskFormProps = {
  mode: 'create' | 'edit'
  slug: string
  taskId?: string
}

type SlackTargetUser = {
  id: string
  email: string
  slackLinked: boolean
}

type SlackTargetChannel = {
  channelId: string
  isPrivate: boolean
  name: string
}

export function AutopilotTaskForm({ slug, mode, taskId }: AutopilotTaskFormProps) {
  const router = useRouter()
  const { agents } = useAgentsCatalog(slug)
  const timezoneOptions = useMemo(() => getAutopilotTimeZoneOptions(), [])
  const [task, setTask] = useState<AutopilotTaskDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRunningNow, setIsRunningNow] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [targetAgentId, setTargetAgentId] = useState<string>('')
  const [timezone, setTimezone] = useState('UTC')
  const [enabled, setEnabled] = useState(true)
  const [schedule, setSchedule] = useState<AutopilotScheduleFormState>(getDefaultAutopilotScheduleFormState())
  const [slackIntegrationEnabled, setSlackIntegrationEnabled] = useState(false)
  const [slackNotificationsEnabled, setSlackNotificationsEnabled] = useState(false)
  const [includeSessionLink, setIncludeSessionLink] = useState(true)
  const [targetType, setTargetType] = useState<'dm' | 'channel'>('dm')
  const [selectedDmUser, setSelectedDmUser] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('')
  const [notificationTargets, setNotificationTargets] = useState<AutopilotSlackNotificationTarget[]>([])
  const [teamMembers, setTeamMembers] = useState<SlackTargetUser[]>([])
  const [slackChannels, setSlackChannels] = useState<SlackTargetChannel[]>([])
  const [slackNotificationError, setSlackNotificationError] = useState<string | null>(null)

  const loadTask = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as
        | { task?: AutopilotTaskDetail; error?: string }
        | null

      if (!response.ok || !data?.task) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setTask(data.task)
      setName(data.task.name)
      setPrompt(data.task.prompt)
      setTargetAgentId(data.task.targetAgentId ?? '')
      setTimezone(data.task.timezone)
      setEnabled(data.task.enabled)
      setSchedule(inferAutopilotScheduleFormState(data.task.cronExpression))
      if (data.task.slackNotificationConfig) {
        setSlackNotificationsEnabled(data.task.slackNotificationConfig.enabled)
        setIncludeSessionLink(data.task.slackNotificationConfig.includeSessionLink)
        setNotificationTargets(data.task.slackNotificationConfig.targets)
      }
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [mode, slug, taskId])

  useEffect(() => {
    void loadTask()
  }, [loadTask])

  const loadSlackTargets = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/slack-targets`, { cache: 'no-store' })
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
      console.error('[autopilot-form] Failed to load Slack targets', error)
      setSlackIntegrationEnabled(false)
    }
  }, [slug])

  useEffect(() => {
    void loadSlackTargets()
  }, [loadSlackTargets])

  const schedulePreview = useMemo(
    () => getAutopilotSchedulePreview(schedule, timezone),
    [schedule, timezone],
  )
  const cronExpression = schedulePreview.cronExpression
  const isScheduleValid = schedulePreview.isValid

  const canAddTarget = useMemo(() => {
    if (targetType === 'dm') {
      return selectedDmUser.length > 0 && !notificationTargets.some((target) => target.type === 'dm' && target.userId === selectedDmUser)
    }

    return selectedChannel.length > 0 && !notificationTargets.some((target) => target.type === 'channel' && target.channelId === selectedChannel)
  }, [notificationTargets, selectedChannel, selectedDmUser, targetType])

  const getTargetLabel = useCallback((target: AutopilotSlackNotificationTarget): string => {
    if (target.type === 'dm') {
      const member = teamMembers.find((item) => item.id === target.userId)
      return `DM: ${member?.email ?? target.userId}`
    }

    const channel = slackChannels.find((item) => item.channelId === target.channelId)
    return `Channel: ${channel?.name ?? target.channelId}`
  }, [slackChannels, teamMembers])

  const addNotificationTarget = useCallback(() => {
    if (!canAddTarget) {
      return
    }

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

  const handleSave = useCallback(async () => {
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
        : mode === 'edit' && task?.slackNotificationConfig
          ? null
          : undefined

      const response = await fetch(
        mode === 'create' ? `/api/u/${slug}/autopilot` : `/api/u/${slug}/autopilot/${taskId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cronExpression,
            enabled,
            name,
            prompt,
            slackNotificationConfig,
            targetAgentId: targetAgentId || null,
            timezone,
          }),
        },
      )

      const data = (await response.json().catch(() => null)) as
        | { task?: AutopilotTaskDetail; error?: string }
        | null

      if (!response.ok || !data?.task) {
        setFormError(data?.error ?? 'save_failed')
        return
      }

      setTask(data.task)
      if (mode === 'create') {
        router.push(`/u/${slug}/autopilot/${data.task.id}`)
        return
      }

      await loadTask()
    } catch {
      setFormError('network_error')
    } finally {
      setIsSaving(false)
    }
  }, [cronExpression, enabled, includeSessionLink, loadTask, mode, name, notificationTargets, prompt, router, slackNotificationsEnabled, slug, targetAgentId, task, taskId, timezone])

  const handleDelete = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsDeleting(true)
    setFormError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setFormError(data?.error ?? 'delete_failed')
        return
      }

      router.push(`/u/${slug}/autopilot`)
    } catch {
      setFormError('network_error')
    } finally {
      setIsDeleting(false)
    }
  }, [mode, router, slug, taskId])

  const handleRunNow = useCallback(async () => {
    if (mode !== 'edit' || !taskId) {
      return
    }

    setIsRunningNow(true)
    setFormError(null)
    try {
      const response = await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setFormError(data?.error ?? 'run_failed')
        return
      }

      await loadTask()
    } catch {
      setFormError('network_error')
    } finally {
      setIsRunningNow(false)
    }
  }, [loadTask, mode, slug, taskId])

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          Loading autopilot task...
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load autopilot task</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void loadTask()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="autopilot-name">Task name</Label>
            <Input
              id="autopilot-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Daily KPI summary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="autopilot-agent">Target agent</Label>
            <div className="relative">
              <select
                id="autopilot-agent"
                value={targetAgentId}
                onChange={(event) => setTargetAgentId(event.target.value)}
                className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <option value="">Primary agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autopilot-timezone">Timezone</Label>
            <Input
              id="autopilot-timezone"
              list="autopilot-timezones"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Madrid"
            />
            <datalist id="autopilot-timezones">
              {timezoneOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
        </div>

        <AutopilotScheduleBuilder
          preview={schedulePreview}
          schedule={schedule}
          timezone={timezone}
          onChange={setSchedule}
        />

        {slackIntegrationEnabled ? (
          <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="slack-notifications">Slack notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Send Autopilot results to Slack DMs or allowlisted channels.
                </p>
              </div>
              <Switch
                checked={slackNotificationsEnabled}
                onCheckedChange={setSlackNotificationsEnabled}
                id="slack-notifications"
              />
            </div>

            {slackNotificationsEnabled ? (
              <div className="space-y-4 border-t border-border/40 pt-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="include-session-link">Include session link</Label>
                  <Switch
                    checked={includeSessionLink}
                    onCheckedChange={setIncludeSessionLink}
                    id="include-session-link"
                  />
                </div>

                <div className="space-y-3">
                  <Label>Notification targets</Label>
                  <div className="space-y-2">
                    <label htmlFor="target-dm" className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name="target-type"
                        id="target-dm"
                        value="dm"
                        checked={targetType === 'dm'}
                        onChange={() => setTargetType('dm')}
                      />
                      Send to user DM
                    </label>

                    {targetType === 'dm' ? (
                      <div className="ml-6">
                        <select
                          aria-label="Slack DM target"
                          value={selectedDmUser}
                          onChange={(event) => setSelectedDmUser(event.target.value)}
                          className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
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

                    <label htmlFor="target-channel" className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name="target-type"
                        id="target-channel"
                        value="channel"
                        checked={targetType === 'channel'}
                        onChange={() => setTargetType('channel')}
                      />
                      Send to channel
                    </label>

                    {targetType === 'channel' ? (
                      slackChannels.length > 0 ? (
                        <div className="ml-6">
                          <select
                            aria-label="Slack channel target"
                            value={selectedChannel}
                            onChange={(event) => setSelectedChannel(event.target.value)}
                            className="flex h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
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
                        <p className="ml-6 text-xs text-muted-foreground">
                          No channels available. Configure notification channels in Slack settings.
                        </p>
                      )
                    ) : null}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addNotificationTarget()}
                    disabled={!canAddTarget}
                  >
                    Add target
                  </Button>

                  {notificationTargets.length > 0 ? (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs font-medium text-muted-foreground">Active targets ({notificationTargets.length})</p>
                      {notificationTargets.map((target, index) => (
                        <div key={`${target.type}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                          <span>{getTargetLabel(target)}</span>
                          <button
                            type="button"
                            onClick={() => removeNotificationTarget(index)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {slackNotificationError ? (
                  <p className="text-sm text-destructive">{slackNotificationError}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="autopilot-prompt">Prompt</Label>
          <textarea
            id="autopilot-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={8}
            className="min-h-[180px] w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            placeholder="Summarize the most important updates from the knowledge base and propose the next actions."
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enabled</p>
            <p className="text-xs text-muted-foreground">
              Disabled tasks stay saved but will not execute on schedule.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable autopilot task" />
        </div>

        {formError ? (
          <p className="text-sm text-destructive">{formError}</p>
        ) : null}

        <div className="flex items-center justify-between border-t border-border/40 pt-5">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleSave()} disabled={isSaving || !isScheduleValid}>
              {isSaving ? 'Saving...' : mode === 'create' ? 'Create task' : 'Save changes'}
            </Button>

            {mode === 'edit' && taskId ? (
              <Button variant="outline" onClick={() => void handleRunNow()} disabled={isRunningNow}>
                {isRunningNow ? 'Running...' : 'Run now'}
              </Button>
            ) : null}

            <Button variant="outline" asChild>
              <Link href={`/u/${slug}/autopilot`}>Back to list</Link>
            </Button>
          </div>

          {mode === 'edit' && taskId ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete task'}
            </button>
          ) : null}
        </div>
      </div>

      {mode === 'edit' && task ? <AutopilotRunHistory slug={slug} task={task} /> : null}
    </div>
  )
}
