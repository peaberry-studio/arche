import Link from 'next/link'
import { redirect } from 'next/navigation'

import { WebSkillForm } from '@/components/skills/web-skill-form'
import { getSession } from '@/lib/runtime/session'

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ name: string; slug: string }>
}) {
  const { slug, name } = await params

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
            <h1 className="type-display text-3xl font-semibold tracking-tight">Edit skill</h1>
            <p className="text-muted-foreground">
              Update the `SKILL.md` instructions and default agent assignments.
            </p>
          </div>
        </div>

        <WebSkillForm slug={slug} mode="edit" skillName={name} />
      </div>
    </main>
  )
}
