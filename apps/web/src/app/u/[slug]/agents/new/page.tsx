import { redirect } from 'next/navigation'
import Link from 'next/link'

import { AgentForm } from '@/components/agents/agent-form'
import { getSession } from '@/lib/runtime/session'

export default async function NewAgentPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await getSession()

  if (session?.user.role !== 'ADMIN') {
    redirect(`/u/${slug}/agents`)
  }

  return (
    <main className="relative mx-auto max-w-3xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <div className="mb-5">
            <Link
              href={`/u/${slug}/agents`}
              className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; Back to agents
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Create agent
            </h1>
            <p className="text-muted-foreground">
              Define the role, model, and prompt for the new agent.
            </p>
          </div>
        </div>

        <AgentForm slug={slug} mode="create" />
      </div>
    </main>
  )
}
