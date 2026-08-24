import { redirect } from 'next/navigation'

import { getWorkspaceFlowsHref } from '@/lib/workspace-hrefs'

export default async function EditFlowPage({
  params
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  redirect(getWorkspaceFlowsHref(slug, 'edit', id))
}
