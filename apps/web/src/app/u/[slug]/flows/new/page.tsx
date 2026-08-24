import { redirect } from 'next/navigation'

import { getWorkspaceFlowsHref } from '@/lib/workspace-hrefs'

export default async function NewFlowPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceFlowsHref(slug, 'new'))
}
