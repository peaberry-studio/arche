import Link from 'next/link'
import { redirect } from 'next/navigation'

import { DashboardHero } from '@/components/dashboard/dashboard-hero'
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
import { isDesktop } from '@/lib/runtime/mode'
import { listSkills } from '@/lib/skills/skill-store'

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
      <main className="relative px-6 py-8">
        <section className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/10 p-8 sm:p-10">
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
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                {setupNotice.text}
              </div>
            )}

            {kickstartStatus === 'setup_in_progress' && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
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

  const [configResult, recentUpdatesResult, skillsResult] = await Promise.all([
    readCommonWorkspaceConfig(),
    listRecentKbFileUpdates(10),
    listSkills(),
  ])

  const parsedConfig = configResult.ok ? parseCommonWorkspaceConfig(configResult.content) : null
  const agents = parsedConfig?.ok
    ? getAgentSummaries(parsedConfig.config)
        .sort((a, b) => {
          if (a.isPrimary && !b.isPrimary) return -1
          if (!a.isPrimary && b.isPrimary) return 1
          return a.displayName.localeCompare(b.displayName)
        })
        .map((agent) => ({
          id: agent.id,
          displayName: agent.displayName,
          description: agent.description,
          isPrimary: agent.isPrimary,
        }))
    : []

  const recentUpdates = recentUpdatesResult.ok
    ? recentUpdatesResult.updates.map((update) => ({
        fileName: update.fileName,
        filePath: update.filePath,
      }))
    : []

  const skills = skillsResult.ok
    ? skillsResult.data.map((skill) => ({ name: skill.name, description: skill.description }))
    : []

  return (
    <main className="relative flex min-h-[calc(100dvh-6rem)] flex-col px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        {setupNotice && (
          <section
            className={
              setupNotice.tone === 'success'
                ? 'mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800'
                : 'mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground'
            }
          >
            {setupNotice.text}
          </section>
        )}

        <div className="flex flex-1 items-center justify-center">
          <DashboardHero
            slug={slug}
            agents={agents}
            recentUpdates={recentUpdates}
            skills={skills}
          />
        </div>
      </div>
    </main>
  )
}
