import { redirect } from 'next/navigation'

import { getWorkspaceFlowsHref } from '@/lib/workspace-hrefs'

export default async function FlowsPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceFlowsHref(slug, 'list'))
}
