'use client'

import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { getTeamErrorMessage } from '@/components/team/error-messages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getProviderLabel } from '@/lib/providers/catalog'

type UsageTotals = {
  requestCount: number
  errorCount: number
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

type UsageUserRow = UsageTotals & {
  user: { email: string; slug: string } | null
  userId: string
}

type UsageProviderRow = UsageTotals & {
  credentialSource: string
  modelId: string
  providerId: string
  source: string
}

type UsageSessionRow = {
  id: string
  user: { email: string; slug: string } | null
  createdAt: string
  durationMs: number
  lastSeenAt: string | null
  revokedAt: string | null
}

type UsageAuditRow = {
  id: string
  action: string
  actorUser: { email: string; slug: string } | null
  createdAt: string
}

type UsageAnalyticsPanelProps = {
  slug: string
}

type UsageData = {
  summary: UsageTotals
  users: UsageUserRow[]
  providers: UsageProviderRow[]
  sessions: UsageSessionRow[]
  auditEvents: UsageAuditRow[]
}

const EMPTY_TOTALS: UsageTotals = {
  costUsd: 0,
  errorCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  requestCount: 0,
  runCount: 0,
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, { currency: 'USD', maximumFractionDigits: 4, style: 'currency' }).format(value)
}

function formatDuration(durationMs: number): string {
  const minutes = Math.max(0, Math.round(durationMs / 60_000))
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'n/a'
}

function buildQuery(filters: Record<string, string>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim())
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

async function fetchJson<T>(url: string, key: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null

  if (!response.ok || !data) {
    throw new Error(getTeamErrorMessage(data?.error ?? `${key}_load_failed`))
  }

  return data
}

export function UsageAnalyticsPanel({ slug }: UsageAnalyticsPanelProps) {
  const [filters, setFilters] = useState({ from: '', modelId: '', providerId: '', to: '', userId: '' })
  const [appliedFilters, setAppliedFilters] = useState(filters)
  const [data, setData] = useState<UsageData>({
    auditEvents: [],
    providers: [],
    sessions: [],
    summary: EMPTY_TOTALS,
    users: [],
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadUsage = useCallback(async () => {
    const query = buildQuery(appliedFilters)
    try {
      const [summary, users, providers, sessions, audit] = await Promise.all([
        fetchJson<{ summary: UsageTotals }>(`/api/u/${slug}/usage/summary${query}`, 'summary'),
        fetchJson<{ users: UsageUserRow[] }>(`/api/u/${slug}/usage/users${query}`, 'users'),
        fetchJson<{ providers: UsageProviderRow[] }>(`/api/u/${slug}/usage/providers${query}`, 'providers'),
        fetchJson<{ sessions: UsageSessionRow[] }>(`/api/u/${slug}/usage/sessions${query}`, 'sessions'),
        fetchJson<{ auditEvents: UsageAuditRow[] }>(`/api/u/${slug}/usage/audit${query}`, 'audit'),
      ])

      setData({
        auditEvents: audit.auditEvents,
        providers: providers.providers,
        sessions: sessions.sessions,
        summary: summary.summary,
        users: users.users,
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : getTeamErrorMessage('network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [appliedFilters, slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialUsage() {
      try {
        await loadUsage()
      } finally {
        if (cancelled) return
      }
    }

    void loadInitialUsage()

    return () => {
      cancelled = true
    }
  }, [loadUsage])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    setAppliedFilters(filters)
  }

  return (
    <div className="space-y-5">
      <form className="grid gap-3 rounded-lg border border-border/60 bg-background/60 p-4 md:grid-cols-6" onSubmit={handleSubmit}>
        <Input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        <Input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        <Input placeholder="User id" value={filters.userId} onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))} />
        <Input placeholder="Provider" value={filters.providerId} onChange={(event) => setFilters((current) => ({ ...current, providerId: event.target.value }))} />
        <Input placeholder="Model" value={filters.modelId} onChange={(event) => setFilters((current) => ({ ...current, modelId: event.target.value }))} />
        <Button type="submit" disabled={isLoading}>{isLoading ? 'Loading...' : 'Apply filters'}</Button>
      </form>

      {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Requests" value={formatNumber(data.summary.requestCount)} />
        <MetricCard label="Errors" value={formatNumber(data.summary.errorCount)} />
        <MetricCard label="Runs" value={formatNumber(data.summary.runCount)} />
        <MetricCard label="Cost" value={formatCost(data.summary.costUsd)} />
        <MetricCard label="Input tokens" value={formatNumber(data.summary.inputTokens)} />
        <MetricCard label="Output tokens" value={formatNumber(data.summary.outputTokens)} />
      </div>

      <UsageTable title="By User" empty="No user usage recorded." headers={['User', 'Requests', 'Runs', 'Tokens', 'Cost']}>
        {data.users.map((row) => (
          <tr key={row.userId} className="border-t border-border/60">
            <td className="px-3 py-2">{row.user?.email ?? row.userId}</td>
            <td className="px-3 py-2">{formatNumber(row.requestCount)}</td>
            <td className="px-3 py-2">{formatNumber(row.runCount)}</td>
            <td className="px-3 py-2">{formatNumber(row.inputTokens + row.outputTokens)}</td>
            <td className="px-3 py-2">{formatCost(row.costUsd)}</td>
          </tr>
        ))}
      </UsageTable>

      <UsageTable title="By Provider" empty="No provider usage recorded." headers={['Provider', 'Model', 'Source', 'Requests', 'Runs', 'Cost']}>
        {data.providers.map((row) => (
          <tr key={`${row.providerId}:${row.modelId}:${row.source}:${row.credentialSource}`} className="border-t border-border/60">
            <td className="px-3 py-2">{getProviderLabel(row.providerId)}</td>
            <td className="px-3 py-2">{row.modelId || 'unknown'}</td>
            <td className="px-3 py-2">{row.source} / {row.credentialSource}</td>
            <td className="px-3 py-2">{formatNumber(row.requestCount)}</td>
            <td className="px-3 py-2">{formatNumber(row.runCount)}</td>
            <td className="px-3 py-2">{formatCost(row.costUsd)}</td>
          </tr>
        ))}
      </UsageTable>

      <UsageTable title="Recent Sessions" empty="No sessions found." headers={['User', 'Started', 'Last seen', 'Duration']}>
        {data.sessions.map((session) => (
          <tr key={session.id} className="border-t border-border/60">
            <td className="px-3 py-2">{session.user?.email ?? session.id}</td>
            <td className="px-3 py-2">{formatDate(session.createdAt)}</td>
            <td className="px-3 py-2">{formatDate(session.revokedAt ?? session.lastSeenAt)}</td>
            <td className="px-3 py-2">{formatDuration(session.durationMs)}</td>
          </tr>
        ))}
      </UsageTable>

      <UsageTable title="Audit Log" empty="No audit events found." headers={['Actor', 'Action', 'Time']}>
        {data.auditEvents.map((event) => (
          <tr key={event.id} className="border-t border-border/60">
            <td className="px-3 py-2">{event.actorUser?.email ?? 'system'}</td>
            <td className="px-3 py-2">{event.action}</td>
            <td className="px-3 py-2">{formatDate(event.createdAt)}</td>
          </tr>
        ))}
      </UsageTable>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

function UsageTable({
  children,
  empty,
  headers,
  title,
}: {
  children: ReactNode
  empty: string
  headers: string[]
  title: string
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/60">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
