import { redirect } from 'next/navigation'

import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

export default async function EditSkillPage({
  params
}: {
  params: Promise<{ slug: string; name: string }>
}) {
  const { slug, name } = await params
  redirect(getWorkspaceCatalogHref(slug, 'skills', name))
}
