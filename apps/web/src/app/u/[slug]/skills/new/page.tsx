import { redirect } from 'next/navigation'

import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

export default async function NewSkillPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceCatalogHref(slug, 'skills', 'new'))
}
