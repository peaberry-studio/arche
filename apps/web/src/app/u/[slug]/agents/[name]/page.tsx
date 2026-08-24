import { redirect } from 'next/navigation'

import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

export default async function EditAgentPage({
  params
}: {
  params: Promise<{ slug: string; name: string }>
}) {
  const { slug, name } = await params
  redirect(getWorkspaceCatalogHref(slug, 'agents', name))
}
