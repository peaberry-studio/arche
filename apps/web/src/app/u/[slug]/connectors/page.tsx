import { redirect } from 'next/navigation'

import { getWorkspaceHref } from '@/lib/workspace-hrefs'

export default async function ConnectorsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceHref(slug, { settings: 'connectors' }))
}
