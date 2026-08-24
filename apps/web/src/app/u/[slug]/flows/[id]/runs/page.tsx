import { redirect } from 'next/navigation'

import { getWorkspaceFlowsHref } from '@/lib/workspace-hrefs'

export default async function FlowRunsPage({
  params
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  redirect(getWorkspaceFlowsHref(slug, 'runs', id))
}
