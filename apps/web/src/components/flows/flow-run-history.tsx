'use client'

import Link from 'next/link'
import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
  CircleNotch,
  ClockCountdown,
  Hourglass,
  MinusCircle,
  Prohibit,
  XCircle,
} from '@phosphor-icons/react'

import { HumanStepResponseCard } from '@/components/flows/human-step-response-card'
import { formatFlowRunDate } from '@/lib/flows/cron'
import { cn } from '@/lib/utils'
import type { FlowDetail, FlowRunListItem, FlowRunStepListItem } from '@/lib/flows/types'
import { getWorkspaceHref } from '@/lib/workspace-hrefs'

type FlowRunHistoryProps = {
  flow: FlowDetail
  slug: string
  onRefresh?: () => Promise<void> | void
}

type RunTone = 'success' | 'danger' | 'warning' | 'running' | 'neutral'

const RUN_STATUS_LABEL: Record<FlowRunListItem['status'], string> = {
  cancelled: 'Cancelled',
  failed: 'Failed',
  running: 'Running',
  succeeded: 'Succeeded',
  waiting_for_human: 'Waiting for human',
}

const TRIGGER_LABEL: Record<FlowRunListItem['trigger'], string> = {
  manual: 'Manual',
  on_create: 'On create',
  resume: 'Resume',
  schedule: 'Schedule',
}

function getRunTone(status: FlowRunListItem['status']): RunTone {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'cancelled') return 'neutral'
  if (status === 'waiting_for_human') return 'warning'
  return 'running'
}

function getStepTone(status: FlowRunStepListItem['status']): RunTone {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'running'
  if (status === 'waiting_for_human') return 'warning'
  return 'neutral'
}

const TONE_TEXT: Record<RunTone, string> = {
  danger: 'text-destructive',
  neutral: 'text-muted-foreground',
  running: 'text-primary',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
}

function RunStatusIcon({ status }: { status: FlowRunListItem['status'] }) {
  const tone = getRunTone(status)
  const className = cn('relative z-10 shrink-0', TONE_TEXT[tone])

  if (status === 'succeeded') return <CheckCircle size={14} weight="fill" className={className} />
  if (status === 'failed') return <XCircle size={14} weight="fill" className={className} />
  if (status === 'cancelled') return <Prohibit size={14} weight="fill" className={className} />
  if (status === 'waiting_for_human') return <Hourglass size={14} weight="fill" className={className} />
  return <CircleNotch size={14} weight="bold" className={cn(className, 'animate-spin')} />
}

function StepStatusIcon({ status }: { status: FlowRunStepListItem['status'] }) {
  const tone = getStepTone(status)
  const className = cn('relative z-10 shrink-0', TONE_TEXT[tone])

  if (status === 'succeeded') return <CheckCircle size={14} weight="fill" className={className} />
  if (status === 'failed') return <XCircle size={14} weight="fill" className={className} />
  if (status === 'running') return <CircleNotch size={14} weight="bold" className={cn(className, 'animate-spin')} />
  if (status === 'waiting_for_human') return <Hourglass size={14} weight="fill" className={className} />
  if (status === 'skipped') return <MinusCircle size={14} weight="fill" className={className} />
  return <Circle size={14} weight="bold" className={className} />
}

const RELATIVE_THRESHOLDS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { ms: 60_000, unit: 'second' },
  { ms: 3_600_000, unit: 'minute' },
  { ms: 86_400_000, unit: 'hour' },
  { ms: 604_800_000, unit: 'day' },
  { ms: 2_629_800_000, unit: 'week' },
  { ms: 31_557_600_000, unit: 'month' },
  { ms: Number.POSITIVE_INFINITY, unit: 'year' },
]

const RELATIVE_DIVISORS: Record<Intl.RelativeTimeFormatUnit, number> = {
  day: 86_400_000,
  days: 86_400_000,
  hour: 3_600_000,
  hours: 3_600_000,
  minute: 60_000,
  minutes: 60_000,
  month: 2_629_800_000,
  months: 2_629_800_000,
  quarter: 7_889_400_000,
  quarters: 7_889_400_000,
  second: 1_000,
  seconds: 1_000,
  week: 604_800_000,
  weeks: 604_800_000,
  year: 31_557_600_000,
  years: 31_557_600_000,
}

function formatRelativeTime(date: Date, now: Date): string {
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  const diff = date.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const bucket = RELATIVE_THRESHOLDS.find(({ ms }) => abs < ms) ?? RELATIVE_THRESHOLDS[RELATIVE_THRESHOLDS.length - 1]
  const value = Math.round(diff / RELATIVE_DIVISORS[bucket.unit])
  return formatter.format(value, bucket.unit)
}

function formatDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSeconds = seconds % 60
  if (minutes < 60) return remSeconds ? `${minutes}m ${remSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function MetaDot() {
  return <span aria-hidden className="text-muted-foreground/40">·</span>
}

function StepRow({ step, isLast }: { step: FlowRunStepListItem; isLast: boolean }) {
  const detail = step.compactedOutput
    ? `Compact: ${step.compactedOutput}`
    : step.rawOutput
    ? step.rawOutput
    : null

  return (
    <li className={cn('relative', !isLast && 'pb-3')}>
      {!isLast ? (
        <span aria-hidden className="pointer-events-none absolute left-[6.5px] top-[10px] bottom-0 w-px bg-border/60" />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <StepStatusIcon status={step.status} />
        <span className="font-medium text-foreground/90">{step.nodeName ?? step.nodeId}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{step.nodeType}</span>
      </div>
      {detail ? <p className="ml-[22px] mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">{detail}</p> : null}
      {step.humanResponse ? (
        <p className="ml-[22px] mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">Human: {step.humanResponse}</p>
      ) : null}
      {step.error ? <p className="ml-[22px] mt-0.5 text-xs text-destructive">{step.error}</p> : null}
    </li>
  )
}

function RunCard({
  run,
  flow,
  slug,
  now,
  onRefresh,
}: {
  run: FlowRunListItem
  flow: FlowDetail
  slug: string
  now: Date
  onRefresh?: () => Promise<void> | void
}) {
  const tone = getRunTone(run.status)
  const startedDate = new Date(run.startedAt)
  const relative = formatRelativeTime(startedDate, now)
  const absolute = formatFlowRunDate(startedDate, flow.timezone)
  const duration = formatDuration(run.startedAt, run.finishedAt)
  const executionUser = run.executionUser ?? flow.owner
  const canOpenSession = Boolean(run.openCodeSessionId && (!executionUser || executionUser.slug === slug))

  return (
    <li className="rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <RunStatusIcon status={run.status} />
            <span className={cn('text-sm font-semibold', TONE_TEXT[tone])}>{RUN_STATUS_LABEL[run.status]}</span>
            <MetaDot />
            <time dateTime={run.startedAt} title={absolute} className="text-sm text-muted-foreground">
              {relative}
            </time>
            {duration ? (
              <>
                <MetaDot />
                <span className="text-sm text-muted-foreground">{duration}</span>
              </>
            ) : null}
            <span className="ml-1 inline-flex items-center rounded-md bg-muted px-1.5 py-1 text-[9px] font-medium uppercase tracking-[0.1em] leading-none text-muted-foreground">
              {TRIGGER_LABEL[run.trigger]}
            </span>
          </div>
          {executionUser ? <p className="ml-[22px] text-xs text-muted-foreground">Executed by {executionUser.slug}</p> : null}
          {run.error ? <p className="ml-[22px] text-xs text-destructive">{run.error}</p> : null}
          {run.retryScheduledFor ? (
            <p className="ml-[22px] flex items-center gap-1 text-xs text-muted-foreground">
              <ClockCountdown size={12} weight="bold" className="text-amber-500" />
              Retry attempt {run.attempt} scheduled for {formatFlowRunDate(new Date(run.retryScheduledFor), flow.timezone)}
            </p>
          ) : null}
          {run.lastRetryError && !run.error ? (
            <p className="ml-[22px] text-xs text-muted-foreground">Last retry error: {run.lastRetryError}</p>
          ) : null}
        </div>

        {canOpenSession && run.openCodeSessionId ? (
          <Link
            href={getWorkspaceHref(slug, { mode: 'flows', sessionId: run.openCodeSessionId })}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Open session
            <ArrowSquareOut size={12} weight="bold" />
          </Link>
        ) : null}
      </div>

      {run.steps.length > 0 ? (
        <div className="relative mt-4">
          <span
            aria-hidden
            className="pointer-events-none absolute left-[6.5px] -top-4 h-[26px] w-px bg-border/60"
          />
          <ol className="space-y-0">
            {run.steps.map((step, index) => (
              <StepRow key={step.id} step={step} isLast={index === run.steps.length - 1} />
            ))}
          </ol>
        </div>
      ) : null}

      {run.status === 'waiting_for_human' && (!executionUser || executionUser.slug === slug) ? (
        <div className="mt-4">
          <HumanStepResponseCard run={run} slug={slug} onSubmitted={onRefresh} />
        </div>
      ) : null}
    </li>
  )
}

export function FlowRunHistory({ flow, slug, onRefresh }: FlowRunHistoryProps) {
  const now = new Date()

  if (flow.runs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 py-10 text-center">
        <ClockCountdown size={28} className="text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
      </div>
    )
  }

  return (
    <ol className="space-y-3">
      {flow.runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          flow={flow}
          slug={slug}
          now={now}
          onRefresh={onRefresh}
        />
      ))}
    </ol>
  )
}
