import { redirect } from 'next/navigation'

import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

export default async function NewAgentPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceCatalogHref(slug, 'agents', 'new'))
}
