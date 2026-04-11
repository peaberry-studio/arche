import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ConnectorsWidget } from '@/components/dashboard/connectors-widget'
import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/runtime/session'
import {
  listRecentKbFileUpdates,
  readCommonWorkspaceConfig,
} from '@/lib/common-workspace-config-store'
import { getKickstartStatus } from '@/kickstart/status'
import type { KickstartStatus } from '@/kickstart/types'
import { getAgentSummaries, parseCommonWorkspaceConfig } from '@/lib/workspace-config'
import { getCurrentDesktopVault } from '@/lib/runtime/desktop/current-vault'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { isDesktop } from '@/lib/runtime/mode'

function formatCommitTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function getSetupNotice(setupParam: string | undefined): {
  text: string
  tone: 'success' | 'warning'
} | null {
  if (!setupParam) return null

  if (setupParam === 'completed') {
    return {
      text: 'Kickstart setup completed. Your workspace is now ready.',
      tone: 'success',
    }
  }

  if (setupParam === 'required') {
    return {
      text: 'Workspace access is blocked until initial setup is completed.',
      tone: 'warning',
    }
  }

  if (setupParam === 'in-progress') {
    return {
      text: 'A setup operation is currently in progress. Please wait before retrying.',
      tone: 'warning',
    }
  }

  if (setupParam === 'admin-required') {
    return {
      text: 'Only administrators can run kickstart setup for this workspace.',
      tone: 'warning',
    }
  }

  return null
}

function isSetupBlocked(status: KickstartStatus): boolean {
  return status === 'needs_setup' || status === 'setup_in_progress'
}

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ setup?: string }>
}) {
  const { slug } = await params
  const search = await searchParams

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      redirect('/')
    }

    redirect('/w/local')
  }

  const setupNotice = getSetupNotice(search?.setup)

  const [kickstartStatus, session] = await Promise.all([
    getKickstartStatus(),
    getSession(),
  ])

  const isAdmin = session?.user.role === 'ADMIN'

  if (isSetupBlocked(kickstartStatus)) {
    return (
      <main className="relative mx-auto max-w-5xl px-6 py-8">
        <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/10 p-8 sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-10 h-44 w-44 rounded-full bg-foreground/10 blur-3xl" />

          <div className="relative z-10 max-w-3xl space-y-5">
            <p className="text-xs uppercase tracking-[0.18em] text-primary/80">Kickstart Required</p>
            <h1 className="type-display text-3xl leading-tight sm:text-4xl">
              Configure your workspace before opening it
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Arche now uses a one-time kickstart flow to initialize your company KB and
              agent configuration. Workspace access stays blocked until setup is complete.
            </p>

            {setupNotice && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
                {setupNotice.text}
              </div>
            )}

            {kickstartStatus === 'setup_in_progress' && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
                Setup is currently running. You can open the wizard to monitor progress,
                but apply may be temporarily locked.
              </div>
            )}

            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>1. Add company details</p>
              <p>2. Choose a workspace template</p>
              <p>3. Select and review agent defaults</p>
              <p>4. Apply kickstart to unlock normal operation</p>
            </div>

            {isAdmin ? (
              <Button asChild size="lg" className="mt-2">
                <Link href={`/u/${slug}/kickstart`}>Start initial setup</Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an administrator to complete kickstart setup for this workspace.
              </p>
            )}
          </div>
        </section>
      </main>
    )
  }

  const configResult = await readCommonWorkspaceConfig()
  const parsedConfig = configResult.ok ? parseCommonWorkspaceConfig(configResult.content) : null
  const agents = parsedConfig?.ok
    ? getAgentSummaries(parsedConfig.config)
      .sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1
        if (!a.isPrimary && b.isPrimary) return 1
        return a.displayName.localeCompare(b.displayName)
      })
      .slice(0, 4)
    : []

  const recentUpdatesResult = await listRecentKbFileUpdates(10)
  const recentUpdates = recentUpdatesResult.ok ? recentUpdatesResult.updates : []
  const caps = getRuntimeCapabilities()

  return (
    <main className="relative mx-auto max-w-6xl overflow-hidden px-6 py-6">
      {setupNotice && (
        <section
          className={
            setupNotice.tone === 'success'
              ? 'mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800'
              : 'mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900'
          }
        >
          {setupNotice.text}
        </section>
      )}

      {/* Hero */}
      <DashboardHero slug={slug} />

      {/* Sections grid */}
      <div className="grid gap-8 md:grid-cols-2">
        {/* Recent Activity */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Recent Activity
            </h2>
          </div>

          <div className="glass-panel rounded-xl">
            {recentUpdates.length === 0 ? (
              <div className="px-5 py-8 text-sm text-muted-foreground">
                No file activity available yet.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentUpdates.map((item) => (
                  <div key={`${item.filePath}-${item.committedAt}`} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{item.fileName}</p>
                        <p className="truncate text-xs text-muted-foreground">{item.filePath}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-foreground">{item.author}</p>
                        <p className="text-xs text-muted-foreground">{formatCommitTime(item.committedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Agents & Connectors */}
        <div className="space-y-8">
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">Agents</h2>
              <Link
                href={`/u/${slug}/agents`}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
              </Link>
            </div>
            <div className="space-y-2">
              {agents.length === 0 ? (
                <div className="glass-panel rounded-lg px-4 py-3 text-sm text-muted-foreground">
                  No agents configured.
                </div>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="glass-panel flex min-w-0 items-center justify-between gap-3 rounded-lg px-4 py-3"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">{agent.displayName}</span>
                    <Badge className="shrink-0" variant={agent.isPrimary ? "default" : "secondary"}>
                      {agent.isPrimary ? 'Primary' : 'Secondary'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">Connectors</h2>
              <Link
                href={`/u/${slug}/connectors`}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View all
              </Link>
            </div>
            <ConnectorsWidget slug={slug} />
          </section>

          {caps.autopilot ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">Autopilot</h2>
                <Link
                  href={`/u/${slug}/autopilot`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Open
                </Link>
              </div>
              <div className="glass-panel rounded-lg px-4 py-4 text-sm text-muted-foreground">
                Schedule recurring prompts that run in the background with cron and timezone-aware execution.
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}
