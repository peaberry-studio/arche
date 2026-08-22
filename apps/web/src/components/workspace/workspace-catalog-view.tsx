'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { AgentsPageClient } from '@/components/agents/agents-page'
import { WebAgentForm } from '@/components/agents/web-agent-form'
import { SkillsPageClient } from '@/components/skills/skills-page'
import { WebSkillForm } from '@/components/skills/web-skill-form'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type WorkspaceCatalogViewProps = {
  isAdmin: boolean
  slug: string
}

const CATALOG_COPY = {
  agents: {
    back: 'Back to agents',
    create: {
      title: 'Create agent',
      description: 'Define the role, model, and prompt for the new agent.',
    },
    edit: {
      title: 'Edit agent',
      description: 'Update the model, temperature, and prompt.',
    },
  },
  skills: {
    back: 'Back to skills',
    create: {
      title: 'Create skill',
      description: 'Define a new `SKILL.md` bundle and choose which agents can use it.',
    },
    edit: {
      title: 'Edit skill',
      description: 'Update the `SKILL.md` instructions and default agent assignments.',
    },
  },
} as const

export function CatalogFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrollbar-custom h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
    </div>
  )
}

function CatalogFormFrame({
  backHref,
  backLabel,
  title,
  description,
  children,
}: {
  backHref: string
  backLabel: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="scrollbar-custom h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="space-y-8">
          <div>
            <div className="mb-5">
              <Link
                href={backHref}
                className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                &larr; {backLabel}
              </Link>
            </div>
            <div className="space-y-2">
              <h1 className="type-display text-3xl font-semibold tracking-tight">{title}</h1>
              <p className="text-muted-foreground">{description}</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceCatalogView({ isAdmin, slug }: WorkspaceCatalogViewProps) {
  const searchParams = useSearchParams()
  const catalog = searchParams.get('catalog')
  if (catalog !== 'agents' && catalog !== 'skills') return null

  const copy = CATALOG_COPY[catalog]
  const listHref = getWorkspaceCatalogHref(slug, catalog)

  if (catalog === 'agents') {
    const agentParam = searchParams.get('agent')
    if (isAdmin && agentParam === 'new') {
      return (
        <CatalogFormFrame
          backHref={listHref}
          backLabel={copy.back}
          title={copy.create.title}
          description={copy.create.description}
        >
          <WebAgentForm slug={slug} mode="create" backHref={listHref} />
        </CatalogFormFrame>
      )
    }
    if (isAdmin && agentParam) {
      return (
        <CatalogFormFrame
          backHref={listHref}
          backLabel={copy.back}
          title={copy.edit.title}
          description={copy.edit.description}
        >
          <WebAgentForm slug={slug} mode="edit" agentId={agentParam} backHref={listHref} />
        </CatalogFormFrame>
      )
    }
    return (
      <CatalogFrame>
        <AgentsPageClient
          slug={slug}
          isAdmin={isAdmin}
          createHref={getWorkspaceCatalogHref(slug, 'agents', 'new')}
          onEdit={(agentId) => {
            window.history.replaceState(null, '', getWorkspaceCatalogHref(slug, 'agents', agentId))
          }}
        />
      </CatalogFrame>
    )
  }

  const skillParam = searchParams.get('skill')
  if (isAdmin && skillParam === 'new') {
    return (
      <CatalogFormFrame
        backHref={listHref}
        backLabel={copy.back}
        title={copy.create.title}
        description={copy.create.description}
      >
        <WebSkillForm slug={slug} mode="create" backHref={listHref} />
      </CatalogFormFrame>
    )
  }
  if (isAdmin && skillParam) {
    return (
      <CatalogFormFrame
        backHref={listHref}
        backLabel={copy.back}
        title={copy.edit.title}
        description={copy.edit.description}
      >
        <WebSkillForm slug={slug} mode="edit" skillName={skillParam} backHref={listHref} />
      </CatalogFormFrame>
    )
  }
  return (
    <CatalogFrame>
      <SkillsPageClient
        slug={slug}
        isAdmin={isAdmin}
        createHref={getWorkspaceCatalogHref(slug, 'skills', 'new')}
        onEdit={(skillName) => {
          window.history.replaceState(null, '', getWorkspaceCatalogHref(slug, 'skills', skillName))
        }}
      />
    </CatalogFrame>
  )
}
