import { redirect } from 'next/navigation'

import { SkillsPageClient } from '@/components/skills/skills-page'
import { getCurrentDesktopVault, getDesktopWorkspaceHref } from '@/lib/runtime/desktop/current-vault'
import { isDesktop } from '@/lib/runtime/mode'
import { getSession } from '@/lib/runtime/session'

export default async function SkillsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (isDesktop()) {
    const vault = getCurrentDesktopVault()
    if (!vault) {
      redirect('/')
    }

    redirect(getDesktopWorkspaceHref(slug, 'skills'))
  }

  const session = await getSession()
  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <SkillsPageClient slug={slug} isAdmin={isAdmin} />
    </main>
  )
}
