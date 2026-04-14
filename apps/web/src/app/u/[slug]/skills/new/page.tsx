import Link from 'next/link'
import { redirect } from 'next/navigation'

import { WebSkillForm } from '@/components/skills/web-skill-form'
import { getSession } from '@/lib/runtime/session'

export default async function NewSkillPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await getSession()
  if (session?.user.role !== 'ADMIN') {
    redirect(`/u/${slug}/skills`)
  }

  return (
    <main className="relative mx-auto max-w-3xl px-6 py-10">
      <div className="space-y-8">
        <div>
          <div className="mb-5">
            <Link
              href={`/u/${slug}/skills`}
              className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; Back to skills
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">Create skill</h1>
            <p className="text-muted-foreground">
              Define a new `SKILL.md` bundle and choose which agents can use it.
            </p>
          </div>
        </div>

        <WebSkillForm slug={slug} mode="create" />
      </div>
    </main>
  )
}
